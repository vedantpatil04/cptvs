import type {
  CheckInResponse,
  DashboardSummary,
  VehicleLookupResponse,
  VisitorAccessResponse,
} from '@cpvts/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn } from './parking-helpers.js';
import {
  adminAccount,
  client,
  createParkingUser,
  createParkingUserWithVehicle,
  errorCode,
} from './user-helpers.js';

const app = createApp(config);

type Caller = 'anonymous' | 'student' | 'pending' | 'visitor' | 'security' | 'admin';
let tokens: Record<Caller, string | undefined>;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  const guard = await signIn('SECURITY_STAFF', 'guard');
  const entry = await parkingApi(app, guard.token).checkInOk(
    'MH12CD5678',
    'FOUR_WHEELER',
    'VISITOR',
    9,
  );
  const access = (
    await client(app).post('/visitor/access', {
      vehicleNumber: 'MH12CD5678',
      sessionNumber: entry.session.sessionNumber,
    })
  ).body as VisitorAccessResponse;
  tokens = {
    anonymous: undefined,
    student: (await createParkingUser({ institutionalId: '2BT22CS001' })).token,
    pending: (await createParkingUser({ institutionalId: '2BT22CS002', verification: 'PENDING' }))
      .token,
    visitor: access.accessToken,
    security: guard.token,
    admin: (await adminAccount()).token,
  };
});

afterAll(disconnectDatabase);

type Call = [method: 'get' | 'post' | 'patch' | 'delete', path: string];

const statusFor = async (caller: Caller, [method, path]: Call) =>
  (await client(app, tokens[caller])[method](path, ...(method === 'get' ? [] : [{}]))).status;

/** Every caller outside `allowed` must be turned away: 401 without a valid account token, 403 with the wrong role. */
const expectBoundary = async (calls: Call[], allowed: Caller[]) => {
  for (const call of calls) {
    for (const caller of Object.keys(tokens) as Caller[]) {
      const status = await statusFor(caller, call);
      const label = `${caller} → ${call[0].toUpperCase()} ${call[1]}`;
      if (allowed.includes(caller)) {
        expect([401, 403], label).not.toContain(status);
      } else if (caller === 'anonymous' || caller === 'visitor') {
        expect(status, label).toBe(401);
      } else {
        expect(status, label).toBe(403);
      }
    }
  }
};

describe('Parking User API (/portal)', () => {
  it('serves only Student / Campus Staff accounts', async () => {
    await expectBoundary(
      [
        ['get', '/portal/profile'],
        ['patch', '/portal/profile'],
        ['get', '/portal/notifications'],
        ['post', '/portal/notifications/read-all'],
        ['post', '/portal/verification/resubmit'],
        ['get', '/portal/account'],
      ],
      ['student', 'pending'],
    );
  });

  it('serves the parking features to verified accounts only', async () => {
    const calls: Call[] = [
      ['get', '/portal/overview'],
      ['get', '/portal/layout'],
      ['get', '/portal/vehicles'],
      ['post', '/portal/vehicles'],
      ['get', '/portal/park-now/offer'],
      ['post', '/portal/park-now/offers'],
      ['post', '/portal/park-now/confirm'],
      ['post', '/portal/park-now/cancel'],
      ['get', '/portal/sessions/active'],
      ['post', '/portal/checkout/quote'],
      ['post', '/portal/sessions/CPVTS-P-00000000/exit-request'],
      ['delete', '/portal/sessions/CPVTS-P-00000000/exit-request'],
      ['delete', '/portal/vehicles/00000000-0000-4000-8000-000000000000'],
      ['get', '/portal/history'],
      ['get', '/portal/receipts'],
    ];
    await expectBoundary(calls, ['student']);
    // A pending account is told verification is required — not that it lacks a role.
    for (const call of calls) {
      const res = await client(app, tokens.pending)[call[0]](
        call[1],
        ...(call[0] === 'get' ? [] : [{}]),
      );
      expect(errorCode(res), call.join(' ')).toBe('VERIFICATION_REQUIRED');
    }
  });
});

describe('Administrator API (/admin)', () => {
  it('is closed to everyone but administrators', async () => {
    await expectBoundary(
      [
        ['get', '/admin/users'],
        ['get', '/admin/users/counts'],
        ['get', '/admin/users/00000000-0000-4000-8000-000000000000'],
        ['patch', '/admin/users/00000000-0000-4000-8000-000000000000'],
        ['post', '/admin/users/00000000-0000-4000-8000-000000000000/status'],
        ['post', '/admin/users/00000000-0000-4000-8000-000000000000/verification'],
        ['get', '/admin/users/00000000-0000-4000-8000-000000000000/history'],
        [
          'get',
          '/admin/users/00000000-0000-4000-8000-000000000000/documents/00000000-0000-4000-8000-000000000000',
        ],
        ['get', '/admin/visitors'],
        ['post', '/admin/notices'],
        ['get', '/admin/layout'],
        ['post', '/admin/slots'],
        ['post', '/admin/blocks'],
        ['post', '/admin/zones'],
        ['get', '/admin/history'],
        ['get', '/admin/audit-logs'],
        ['get', '/admin/integrity'],
        ['get', '/admin/analytics'],
        ['get', '/admin/reports/history'],
      ],
      ['admin'],
    );
  });
});

describe('Security Staff operations (/parking, /dashboard)', () => {
  it('keeps vehicle entry for Security Staff', async () => {
    await expectBoundary([['post', '/parking/check-ins']], ['security']);
  });

  it('keeps the gate checkout for Security Staff and administrators (an override)', async () => {
    await expectBoundary(
      [
        ['post', '/parking/checkouts/scan'],
        ['post', '/parking/checkouts/quote'],
        ['post', '/parking/payments'],
      ],
      ['security', 'admin'],
    );
  });

  it('keeps live views and the dashboard to the operational roles', async () => {
    await expectBoundary(
      [
        ['get', '/parking/map'],
        ['get', '/parking/alerts'],
        ['get', '/parking/sessions/active'],
        ['get', '/parking/tracking'],
        ['get', '/dashboard/summary'],
      ],
      ['security', 'admin'],
    );
  });
});

describe('Visitor API (/visitor)', () => {
  it('needs a visitor token — no account token works', async () => {
    const calls: Call[] = [
      ['get', '/visitor/session'],
      ['get', '/visitor/layout'],
      ['get', '/visitor/receipt'],
      ['post', '/visitor/checkout/quote'],
    ];
    for (const call of calls) {
      for (const caller of ['anonymous', 'student', 'pending', 'security', 'admin'] as Caller[]) {
        expect(await statusFor(caller, call), `${caller} → ${call.join(' ')}`).toBe(401);
      }
    }
    expect(await statusFor('visitor', ['get', '/visitor/session'])).toBe(200);
  });
});

describe('the public overview', () => {
  it('shows no vehicles, sessions, users or revenue', async () => {
    const account = await createParkingUserWithVehicle(app, { institutionalId: '2BT22CS050' });
    await client(app, account.token).post('/portal/park-now/offers', {
      vehicleId: account.vehicle.id,
    });
    const text = JSON.stringify((await client(app).get('/public/overview')).body);
    for (const secret of ['KA22AB1234', 'MH12CD5678', 'CPVTS-P-', '2BT22CS', 'T-01', 'revenue']) {
      expect(text, secret).not.toContain(secret);
    }
  });
});

describe('the owner category comes from the verified account', () => {
  const guard = () => parkingApi(app, tokens.security!);

  it('overrides whatever the desk selects for a verified Student vehicle', async () => {
    const student = await createParkingUserWithVehicle(app, { institutionalId: '2BT22CS060' });
    const res = await guard().checkIn({
      vehicleNumber: student.vehicle.vehicleNumber,
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 9,
    });
    expect(res.status).toBe(201);
    expect((res.body as CheckInResponse).session.ownerCategory).toBe('STUDENT');
    expect((res.body as CheckInResponse).categorySource).toBe('ACCOUNT');
  });

  it('applies to Campus Staff too', async () => {
    const staff = await createParkingUserWithVehicle(app, {
      category: 'STAFF',
      institutionalId: 'EMP-1042',
      vehicleNumber: 'KA01EF0001',
    });
    const res = await guard().checkIn({
      vehicleNumber: staff.vehicle.vehicleNumber,
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'STUDENT',
      entryHour: 9,
    });
    expect((res.body as CheckInResponse).session.ownerCategory).toBe('STAFF');
  });

  it('falls back to the desk category when the owner account is deactivated', async () => {
    const student = await createParkingUserWithVehicle(app, { institutionalId: '2BT22CS061' });
    await prisma.user.update({ where: { id: student.user.id }, data: { isActive: false } });
    const res = await guard().checkIn({
      vehicleNumber: student.vehicle.vehicleNumber,
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 9,
    });
    expect((res.body as CheckInResponse).session.ownerCategory).toBe('VISITOR');
    expect((res.body as CheckInResponse).categorySource).toBe('OPERATOR');
  });

  it('is reported to the entry desk by the vehicle lookup, without any owner details', async () => {
    const student = await createParkingUserWithVehicle(app, {
      institutionalId: '2BT22CS062',
      fullName: 'Secret Name',
    });
    const lookup = async (token: string | undefined, plate: string) =>
      client(app, token).get('/parking/vehicle-lookup', { vehicleNumber: plate });

    const known = await lookup(tokens.security, 'ka-22 ab 1234');
    expect(known.status).toBe(200);
    expect(known.body as VehicleLookupResponse).toEqual({
      vehicleNumber: 'KA22AB1234',
      known: true,
      vehicleType: 'TWO_WHEELER',
      accountCategory: 'STUDENT',
      hasActiveSession: false,
    });
    expect(JSON.stringify(known.body)).not.toMatch(/Secret Name|2BT22CS062|@/);

    await guard().checkInOk('KA22AB1234');
    expect(
      ((await lookup(tokens.security, 'KA22AB1234')).body as VehicleLookupResponse)
        .hasActiveSession,
    ).toBe(true);

    expect((await lookup(tokens.admin, 'KA22AB1234')).status).toBe(200);
    expect((await lookup(tokens.student, 'KA22AB1234')).status).toBe(403);
    expect((await lookup(tokens.visitor, 'KA22AB1234')).status).toBe(401);
    expect((await lookup(undefined, 'KA22AB1234')).status).toBe(401);
    expect((await lookup(tokens.security, 'nope')).status).toBe(400);

    const stranger = (await lookup(tokens.security, 'MH12ZZ0009')).body as VehicleLookupResponse;
    expect(stranger).toEqual({
      vehicleNumber: 'MH12ZZ0009',
      known: false,
      vehicleType: null,
      accountCategory: null,
      hasActiveSession: false,
    });

    await prisma.user.update({ where: { id: student.user.id }, data: { isActive: false } });
    expect(
      ((await lookup(tokens.security, 'KA22AB1234')).body as VehicleLookupResponse).accountCategory,
    ).toBeNull();
  });
});

describe('dashboard figures', () => {
  it('gives the administrator user counts and recent activity, and Security Staff neither', async () => {
    await createParkingUser({ institutionalId: '2BT22CS070' });
    await createParkingUser({ institutionalId: '2BT22CS071', verification: 'PENDING' });
    const guard = parkingApi(app, tokens.security!);
    await guard.checkInOk('KA22AB1234');
    await guard.checkInOk('MH12ZZ0001', 'TWO_WHEELER', 'VISITOR', 10);

    const adminView = (await client(app, tokens.admin).get('/dashboard/summary'))
      .body as DashboardSummary;
    expect(adminView.users).toMatchObject({
      students: 4, // verified + pending from the shared setup, plus the two created here
      pendingVerification: 2,
      activeVisitors: 2,
    });
    expect(adminView.recentActivity?.map((i) => i.vehicleNumber)).toEqual([
      'MH12ZZ0001',
      'KA22AB1234',
      'MH12CD5678',
    ]);
    expect(adminView.todayFeesCollectedPaise).not.toBeNull();

    const guardView = (await client(app, tokens.security).get('/dashboard/summary'))
      .body as DashboardSummary;
    expect(guardView.users).toBeNull();
    expect(guardView.recentActivity).toBeNull();
    expect(guardView.todayFeesCollectedPaise).toBeNull();
    expect(guardView.overall.total).toBe(15);
  });
});
