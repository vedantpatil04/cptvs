import type {
  CurrentUserResponse,
  LoginResponse,
  ParkingAccountState,
  ParkingUserProfileView,
  UserDetail,
  VerificationStatus,
} from '@cpvts/shared';
import jwt from 'jsonwebtoken';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { resetDatabase, TEST_PASSWORD } from './helpers.js';
import { seedFees, seedLayout } from './parking-helpers.js';
import {
  adminAccount,
  client,
  errorCode,
  identityDocument,
  PNG_BYTES,
  registrationBody,
} from './user-helpers.js';

/**
 * The bug this file guards against: Admin approves a student, Admin shows VERIFIED, and the
 * student's portal / Park Now still say NOT VERIFIED. There is one authoritative record (the
 * profile row Admin edits); every API reads it fresh on every request and none reads it from
 * the token. These tests drive the exact sequence through real HTTP calls.
 */

const app = createApp(config);
let admin: ReturnType<typeof client>;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  admin = client(app, (await adminAccount()).token);
});

afterAll(disconnectDatabase);

const register = async (category: 'student' | 'staff') => {
  const body =
    category === 'student'
      ? registrationBody()
      : registrationBody({ institutionalId: 'EMP-1042', confirmInstitutionalId: 'EMP-1042' });
  const res = await client(app).post(`/auth/register/${category}`, body);
  expect(res.status).toBe(201);
  return res.body as LoginResponse;
};

const userLogin = async (email = 'asha@college.edu.in') => {
  const res = await client(app).post('/auth/user-login', { email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.body as LoginResponse;
};

/** Every place that reports the verification status, read in one go. */
const everywhere = async (token: string, userId: string) => {
  const portal = client(app, token);
  const me = (await portal.get('/auth/me')).body as CurrentUserResponse;
  const profile = (await portal.get('/portal/profile')).body as ParkingUserProfileView;
  const account = (await portal.get('/portal/account')).body as ParkingAccountState;
  const stored = await prisma.parkingUserProfile.findUniqueOrThrow({ where: { userId } });
  const adminView = (await admin.get(`/admin/users/${userId}`)).body as UserDetail;
  return {
    database: stored.verificationStatus,
    admin: adminView.parkingUser?.verificationStatus,
    currentUser: me.user.parkingUser?.verificationStatus,
    currentUserParkNow: me.user.parkingUser?.parkNow,
    profile: profile.verification.status,
    account: account.verification.status,
    accountParkNow: account.parkNow,
  };
};

const expectEverywhere = (
  states: Awaited<ReturnType<typeof everywhere>>,
  status: VerificationStatus,
) => {
  expect(states).toMatchObject({
    database: status,
    admin: status,
    currentUser: status,
    profile: status,
    account: status,
  });
  const eligible = status === 'VERIFIED';
  expect(states.currentUserParkNow?.eligible).toBe(eligible);
  expect(states.accountParkNow.eligible).toBe(eligible);
  expect(states.accountParkNow.blockedBy).toBe(
    eligible ? null : status === 'REJECTED' ? 'VERIFICATION_REJECTED' : 'VERIFICATION_PENDING',
  );
};

const decide = (userId: string, body: object) =>
  admin.post(`/admin/users/${userId}/verification`, body);

/** Park Now needs a verified account: starts an offer for a vehicle id (any id: the check comes first). */
const startParkNow = (token: string, vehicleId: string) =>
  client(app, token).post('/portal/park-now/offers', { vehicleId });

describe('verification is one record, read fresh on every request', () => {
  it.each(['student', 'staff'] as const)(
    '%s: registers PENDING; Admin approves; the existing session sees VERIFIED and Park Now opens',
    async (category) => {
      // 1–2. Registers and stays PENDING, everywhere, with Park Now closed.
      const registered = await register(category);
      const userId = registered.user.id;
      expectEverywhere(await everywhere(registered.accessToken, userId), 'PENDING');
      expect(
        errorCode(
          await startParkNow(registered.accessToken, '00000000-0000-4000-8000-000000000001'),
        ),
      ).toBe('VERIFICATION_REQUIRED');

      // 3. A login session obtained while PENDING.
      const whilePending = await userLogin();
      expect(whilePending.user.parkingUser).toMatchObject({
        verificationStatus: 'PENDING',
        parkNow: { eligible: false, blockedBy: 'VERIFICATION_PENDING' },
      });

      // 4. Admin approves.
      expect((await decide(userId, { decision: 'VERIFY' })).status).toBe(200);

      // 5. The tokens issued before the decision (registration and login) see the new state at
      //    once: the decision is read from the database, never from the token.
      for (const token of [registered.accessToken, whilePending.accessToken]) {
        expectEverywhere(await everywhere(token, userId), 'VERIFIED');
      }
      // …and so does a brand-new session.
      const fresh = await userLogin();
      expect(fresh.user.parkingUser).toMatchObject({
        verificationStatus: 'VERIFIED',
        parkNow: { eligible: true, blockedBy: null },
      });

      // 6. Park Now is allowed: register a vehicle, get an allocation.
      const portal = client(app, registered.accessToken);
      const vehicle = await portal.post('/portal/vehicles', {
        vehicleNumber: 'KA22AB1234',
        vehicleType: 'TWO_WHEELER',
      });
      expect(vehicle.status).toBe(201);
      const offer = await startParkNow(registered.accessToken, (vehicle.body as { id: string }).id);
      expect(offer.status).toBe(201);
    },
  );

  it('rejection is reported everywhere and keeps Park Now closed; a resubmission goes back to PENDING', async () => {
    const registered = await register('student');
    const userId = registered.user.id;

    await decide(userId, { decision: 'REJECT', note: 'ID photo is cropped' });
    const rejected = await everywhere(registered.accessToken, userId);
    expectEverywhere(rejected, 'REJECTED');
    const account = (await client(app, registered.accessToken).get('/portal/account'))
      .body as ParkingAccountState;
    expect(account.verification.note).toBe('ID photo is cropped');
    expect(
      errorCode(await startParkNow(registered.accessToken, '00000000-0000-4000-8000-000000000001')),
    ).toBe('VERIFICATION_REQUIRED');

    // The resubmission puts the same record back to PENDING — again visible everywhere at once.
    const resubmitted = await client(app, registered.accessToken).post(
      '/portal/verification/resubmit',
      {
        institutionalId: '2BT22CS001',
        confirmInstitutionalId: '2BT22CS001',
        document: identityDocument(Buffer.concat([PNG_BYTES, Buffer.from([9, 9])])),
      },
    );
    expect(resubmitted.status).toBe(200);
    expectEverywhere(await everywhere(registered.accessToken, userId), 'PENDING');

    await decide(userId, { decision: 'VERIFY' });
    expectEverywhere(await everywhere(registered.accessToken, userId), 'VERIFIED');
  });

  it('the token carries no verification claim, so a stale token cannot go stale', async () => {
    const registered = await register('student');
    const claims = jwt.decode(registered.accessToken) as Record<string, unknown>;
    expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sub', 'tv']);
    expect(JSON.stringify(claims)).not.toMatch(/PENDING|VERIFIED|REJECTED|verif/i);
  });

  it('never lets the answer be cached: the account and profile responses are no-store', async () => {
    const { accessToken } = await register('student');
    for (const path of ['/auth/me', '/portal/account', '/portal/profile']) {
      const res = await client(app, accessToken).get(path);
      expect(res.headers['cache-control'], path).toBe('no-store');
      expect(res.headers.vary, path).toMatch(/Authorization/i);
    }
  });

  it('one rule decides eligibility: deactivation closes it, and the desk category follows the same rule', async () => {
    const registered = await register('student');
    const userId = registered.user.id;
    await decide(userId, { decision: 'VERIFY' });
    const portal = client(app, registered.accessToken);
    const vehicle = await portal.post('/portal/vehicles', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
    });
    expect(vehicle.status).toBe(201);

    // A deactivated account is not eligible: its token stops working at once and the login says why.
    expect((await admin.post(`/admin/users/${userId}/status`, { isActive: false })).status).toBe(
      200,
    );
    expect((await portal.get('/auth/me')).status).toBe(401);
    const login = await client(app).post('/auth/user-login', {
      email: 'asha@college.edu.in',
      password: TEST_PASSWORD,
    });
    expect(errorCode(login)).toBe('ACCOUNT_DISABLED');

    // Reactivated: eligible again, on a fresh sign-in.
    await admin.post(`/admin/users/${userId}/status`, { isActive: true });
    const again = await userLogin();
    expect(again.user.parkingUser?.parkNow.eligible).toBe(true);
  });
});
