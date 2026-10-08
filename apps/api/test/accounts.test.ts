import type {
  ApiErrorBody,
  LoginResponse,
  NotificationsResponse,
  Page,
  ParkingUserProfileView,
  UserCounts,
  UserDetail,
  UserListItem,
} from '@cpvts/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { resetDatabase, TEST_PASSWORD } from './helpers.js';
import { seedFees, seedLayout } from './parking-helpers.js';
import {
  adminAccount,
  client,
  createParkingUser,
  errorCode,
  guardAccount,
  identityDocument,
  PNG_BYTES,
  registrationBody,
} from './user-helpers.js';

const app = createApp(config);
let admin: ReturnType<typeof client>;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  admin = client(app, (await adminAccount()).token);
});

afterAll(disconnectDatabase);

const register = (category: 'student' | 'staff', body: object = registrationBody()) =>
  client(app).post(`/auth/register/${category}`, body);

describe('Student registration', () => {
  it('creates a PENDING account, signs the student in and stores the document privately', async () => {
    const res = await register('student');
    expect(res.status).toBe(201);
    const login = res.body as LoginResponse;
    expect(login.tokenType).toBe('Bearer');
    expect(login.user).toMatchObject({
      role: 'PARKING_USER',
      fullName: 'Asha Patil',
      parkingUser: { category: 'STUDENT', verificationStatus: 'PENDING' },
    });
    // The response never carries credentials or the document.
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|contentBase64|college-id/);

    const profile = await prisma.parkingUserProfile.findFirstOrThrow({
      include: { user: { include: { identityDocuments: true } } },
    });
    expect(profile).toMatchObject({
      category: 'STUDENT',
      institutionalId: '2BT22CS001',
      email: 'asha@college.edu.in',
      phone: '+919845012345',
      verificationStatus: 'PENDING',
    });
    expect(profile.user.identityDocuments).toHaveLength(1);
    expect(profile.user.identityDocuments[0]).toMatchObject({
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.length,
    });

    const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (entry) => entry.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['USER_REGISTERED', 'IDENTITY_SUBMITTED', 'AUTH_LOGIN_SUCCEEDED']),
    );
  });

  it('takes the category from the endpoint, never from the request body', async () => {
    const res = await register('student', registrationBody({ category: 'STAFF', role: 'ADMIN' }));
    expect(res.status).toBe(201);
    const user = await prisma.user.findFirstOrThrow({
      where: { role: 'PARKING_USER' },
      include: { parkingProfile: true },
    });
    expect(user.role).toBe('PARKING_USER');
    expect(user.parkingProfile?.category).toBe('STUDENT');
  });

  it('does not grant parking features before approval', async () => {
    const { accessToken } = (await register('student')).body as LoginResponse;
    const portal = client(app, accessToken);

    const profile = await portal.get('/portal/profile');
    expect(profile.status).toBe(200);
    expect((profile.body as ParkingUserProfileView).verification.status).toBe('PENDING');

    for (const [method, path] of [
      ['get', '/portal/overview'],
      ['get', '/portal/vehicles'],
      ['get', '/portal/sessions/active'],
      ['get', '/portal/park-now/offer'],
    ] as const) {
      const res = await portal[method](path);
      expect(res.status, path).toBe(403);
      expect(errorCode(res), path).toBe('VERIFICATION_REQUIRED');
    }
    const add = await portal.post('/portal/vehicles', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
    });
    expect(errorCode(add)).toBe('VERIFICATION_REQUIRED');
  });

  it.each([
    [
      { confirmInstitutionalId: '2BT22CS999' },
      'body.confirmInstitutionalId',
      'validation.institutionalIdMismatch',
    ],
    [{ password: 'short' }, 'body.password', 'validation.passwordTooShort'],
    [{ email: 'not-an-email' }, 'body.email', 'validation.invalidEmail'],
    [{ phone: '12' }, 'body.phone', 'validation.invalidPhone'],
    [{ fullName: '' }, 'body.fullName', 'validation.required'],
    [
      { institutionalId: '!!', confirmInstitutionalId: '!!' },
      'body.institutionalId',
      'validation.invalidInstitutionalId',
    ],
    [
      { document: identityDocument(PNG_BYTES, 'image/gif') },
      'body.document.mimeType',
      'validation.documentType',
    ],
  ])('rejects invalid input %j', async (override, path, message) => {
    const res = await register('student', registrationBody(override));
    expect(res.status).toBe(400);
    expect((res.body as ApiErrorBody).error.details).toContainEqual({ path, message });
    expect(await prisma.parkingUserProfile.count()).toBe(0);
  });

  it('rejects a document whose content is not the declared type or is too large', async () => {
    const fake = await register(
      'student',
      registrationBody({ document: identityDocument(Buffer.from('<script>alert(1)</script>')) }),
    );
    expect(errorCode(fake)).toBe('INVALID_DOCUMENT');

    const huge = Buffer.concat([PNG_BYTES, Buffer.alloc(2 * 1024 * 1024)]);
    const big = await register('student', registrationBody({ document: identityDocument(huge) }));
    expect(big.status).toBe(400);
    expect(await prisma.parkingUserProfile.count()).toBe(0);
  });

  it('accepts a document just under the size limit through the larger body limit', async () => {
    const nearLimit = Buffer.concat([
      PNG_BYTES,
      Buffer.alloc(2 * 1024 * 1024 - PNG_BYTES.length - 16),
    ]);
    const res = await register(
      'student',
      registrationBody({ document: identityDocument(nearLimit) }),
    );
    expect(res.status).toBe(201);
  });

  it('keeps the small body limit on every other route', async () => {
    const res = await client(app).post('/auth/user-login', {
      email: 'a@college.edu.in',
      password: 'x'.repeat(200_000),
    });
    expect(res.status).toBe(413);
  });

  it('rejects a duplicate e-mail or ID', async () => {
    expect((await register('student')).status).toBe(201);
    const sameEmail = await register(
      'student',
      registrationBody({ institutionalId: '2BT22CS002', confirmInstitutionalId: '2BT22CS002' }),
    );
    expect(errorCode(sameEmail)).toBe('EMAIL_TAKEN');
    const sameId = await register('student', registrationBody({ email: 'other@college.edu.in' }));
    expect(errorCode(sameId)).toBe('INSTITUTIONAL_ID_TAKEN');
    expect(await prisma.parkingUserProfile.count()).toBe(1);
  });

  it('allows the same ID number for a student and a staff member', async () => {
    expect((await register('student')).status).toBe(201);
    const staff = await register('staff', registrationBody({ email: 'staff@college.edu.in' }));
    expect(staff.status).toBe(201);
  });
});

describe('Campus Staff registration', () => {
  it('creates a PENDING staff account that cannot pick its category', async () => {
    const res = await register(
      'staff',
      registrationBody({
        fullName: 'Prof Rao',
        institutionalId: 'emp-1042',
        confirmInstitutionalId: 'EMP-1042',
        email: 'rao@college.edu.in',
      }),
    );
    expect(res.status).toBe(201);
    expect((res.body as LoginResponse).user.parkingUser).toEqual({
      category: 'STAFF',
      verificationStatus: 'PENDING',
    });
  });
});

describe('parking-user sign-in', () => {
  it('signs in with the e-mail address and password', async () => {
    await register('student');
    const ok = await client(app).post('/auth/user-login', {
      email: 'ASHA@college.edu.in',
      password: TEST_PASSWORD,
    });
    expect(ok.status).toBe(200);
    expect((ok.body as LoginResponse).user.parkingUser?.category).toBe('STUDENT');

    const me = await client(app, (ok.body as LoginResponse).accessToken).get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ user: { role: 'PARKING_USER' } });
  });

  it('rejects wrong credentials and unknown e-mails identically', async () => {
    await register('student');
    const wrong = await client(app).post('/auth/user-login', {
      email: 'asha@college.edu.in',
      password: 'not-the-password',
    });
    const unknown = await client(app).post('/auth/user-login', {
      email: 'nobody@college.edu.in',
      password: TEST_PASSWORD,
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((wrong.body as ApiErrorBody).error.message).toBe(
      (unknown.body as ApiErrorBody).error.message,
    );
  });

  it('keeps the two sign-in doors separate', async () => {
    await register('student');
    await adminAccount('boss2');
    await guardAccount('guard2');

    // A parking user cannot use the operational door (by username or e-mail)…
    for (const username of ['student:2bt22cs001', 'asha@college.edu.in']) {
      const res = await client(app).post('/auth/login', { username, password: TEST_PASSWORD });
      expect(res.status, username).toBe(401);
    }
    // …and Admin / Security Staff cannot use the parking-user door.
    for (const email of ['boss2@college.edu.in', 'guard2@college.edu.in']) {
      const res = await client(app).post('/auth/user-login', { email, password: TEST_PASSWORD });
      expect(res.status, email).toBe(401);
    }
  });

  it('refuses a deactivated account', async () => {
    await createParkingUser({ isActive: false, email: 'off@college.edu.in' });
    const res = await client(app).post('/auth/user-login', {
      email: 'off@college.edu.in',
      password: TEST_PASSWORD,
    });
    expect(errorCode(res)).toBe('ACCOUNT_DISABLED');
  });

  it('revokes the token on logout', async () => {
    const { accessToken } = (await register('student')).body as LoginResponse;
    expect((await client(app, accessToken).post('/auth/logout')).status).toBe(204);
    expect((await client(app, accessToken).get('/portal/profile')).status).toBe(401);
  });
});

describe('verification by an administrator', () => {
  const pendingStudent = async () => {
    const { user } = (await register('student')).body as LoginResponse;
    return user.id;
  };

  it('lists the pending queue oldest-first with counts', async () => {
    const first = await pendingStudent();
    await createParkingUser({
      category: 'STAFF',
      verification: 'PENDING',
      institutionalId: 'EMP-2001',
    });
    await createParkingUser({ verification: 'VERIFIED', institutionalId: '2BT22CS010' });

    const queue = (await admin.get('/admin/users', { verification: 'PENDING' }))
      .body as Page<UserListItem>;
    expect(queue.total).toBe(2);
    expect(queue.items[0]?.id).toBe(first);

    const counts = (await admin.get('/admin/users/counts')).body as UserCounts;
    expect(counts).toMatchObject({ students: 2, staff: 1, pendingVerification: 2 });
  });

  it('approves, notifies the user and unlocks parking features', async () => {
    const { accessToken, user } = (await register('student')).body as LoginResponse;
    const res = await admin.post(`/admin/users/${user.id}/verification`, { decision: 'VERIFY' });
    expect(res.status).toBe(200);
    expect((res.body as UserDetail).verification).toMatchObject({
      status: 'VERIFIED',
      reviewedBy: expect.any(String),
    });

    const portal = client(app, accessToken);
    expect((await portal.get('/portal/vehicles')).status).toBe(200);
    const notices = (await portal.get('/portal/notifications')).body as NotificationsResponse;
    expect(notices.unreadCount).toBe(1);
    expect(notices.items[0]?.kind).toBe('VERIFICATION_APPROVED');
    expect((await prisma.auditLog.findMany({ where: { action: 'USER_VERIFIED' } })).length).toBe(1);
  });

  it('rejects only with a reason and shows it to the user', async () => {
    const { accessToken, user } = (await register('student')).body as LoginResponse;
    const noReason = await admin.post(`/admin/users/${user.id}/verification`, {
      decision: 'REJECT',
    });
    expect(noReason.status).toBe(400);

    const res = await admin.post(`/admin/users/${user.id}/verification`, {
      decision: 'REJECT',
      note: 'The photo is unreadable',
    });
    expect(res.status).toBe(200);

    const portal = client(app, accessToken);
    const profile = (await portal.get('/portal/profile')).body as ParkingUserProfileView;
    expect(profile.verification).toMatchObject({
      status: 'REJECTED',
      note: 'The photo is unreadable',
    });
    expect(errorCode(await portal.get('/portal/vehicles'))).toBe('VERIFICATION_REQUIRED');
    const notices = (await portal.get('/portal/notifications')).body as NotificationsResponse;
    expect(notices.items[0]).toMatchObject({
      kind: 'VERIFICATION_REJECTED',
      params: { note: 'The photo is unreadable' },
    });
  });

  it('decides a verification only once', async () => {
    const id = await pendingStudent();
    expect(
      (await admin.post(`/admin/users/${id}/verification`, { decision: 'VERIFY' })).status,
    ).toBe(200);
    const again = await admin.post(`/admin/users/${id}/verification`, {
      decision: 'REJECT',
      note: 'Changed my mind',
    });
    expect(errorCode(again)).toBe('VERIFICATION_NOT_PENDING');
    expect((await portalProfile(id)).verification.status).toBe('VERIFIED');
  });

  it('lets a rejected user resubmit a new document, returning to PENDING', async () => {
    const { accessToken, user } = (await register('student')).body as LoginResponse;
    const portal = client(app, accessToken);

    // Not allowed while still pending.
    const early = await portal.post('/portal/verification/resubmit', {
      institutionalId: '2BT22CS001',
      confirmInstitutionalId: '2BT22CS001',
      document: identityDocument(),
    });
    expect(errorCode(early)).toBe('VERIFICATION_NOT_REJECTED');

    await admin.post(`/admin/users/${user.id}/verification`, {
      decision: 'REJECT',
      note: 'Blurry',
    });
    const res = await portal.post('/portal/verification/resubmit', {
      institutionalId: '2bt22cs001',
      confirmInstitutionalId: '2BT22CS001',
      document: identityDocument(Buffer.concat([PNG_BYTES, Buffer.from([9, 9])])),
    });
    expect(res.status).toBe(200);
    expect((res.body as ParkingUserProfileView).verification).toMatchObject({
      status: 'PENDING',
      note: null,
    });
    expect(await prisma.identityDocument.count({ where: { userId: user.id } })).toBe(2);
  });

  it('keeps identity documents private', async () => {
    const { user } = (await register('student')).body as LoginResponse;
    const detail = (await admin.get(`/admin/users/${user.id}`)).body as UserDetail;
    expect(detail.documents).toHaveLength(1);
    // Metadata only: no bytes in the detail response.
    expect(JSON.stringify(detail)).not.toMatch(/content/i);

    const documentId = detail.documents[0]!.id;
    const file = await admin.get(`/admin/users/${user.id}/documents/${documentId}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('image/png');
    expect(file.headers['cache-control']).toBe('no-store');
    expect(Buffer.from(file.body as Buffer).equals(PNG_BYTES)).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { action: 'IDENTITY_DOCUMENT_VIEWED', entityId: documentId },
      }),
    ).toBe(1);

    // Another user's id with this document id is "not found".
    const other = await createParkingUser({ institutionalId: '2BT22CS777' });
    expect(
      errorCode(await admin.get(`/admin/users/${other.user.id}/documents/${documentId}`)),
    ).toBe('DOCUMENT_NOT_FOUND');
  });

  it('exposes documents to nobody but administrators', async () => {
    const { accessToken, user } = (await register('student')).body as LoginResponse;
    const detail = (await admin.get(`/admin/users/${user.id}`)).body as UserDetail;
    const path = `/admin/users/${user.id}/documents/${detail.documents[0]!.id}`;

    expect((await client(app).get(path)).status).toBe(401);
    expect((await client(app, accessToken).get(path)).status).toBe(403);
    expect((await client(app, (await guardAccount()).token).get(path)).status).toBe(403);
    // Not reachable as a static path either.
    expect((await request(app).get(`/uploads/${detail.documents[0]!.id}`)).status).toBe(404);
  });
});

const portalProfile = async (userId: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { tokenService } = await import('../src/modules/auth/token.service.js');
  const token = tokenService.issueAccessToken(user.id, user.tokenVersion).token;
  return (await client(app, token).get('/portal/profile')).body as ParkingUserProfileView;
};
