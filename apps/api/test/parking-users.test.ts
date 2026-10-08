import type {
  CheckInResponse,
  LoginResponse,
  Page,
  ParkingUserProfileView,
  PortalLayoutResponse,
  PortalOverview,
  ReceiptView,
  RegisteredVehicle,
  UserCounts,
  UserDetail,
  UserListItem,
  VisitorAccessResponse,
  VisitorListItem,
} from '@cpvts/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { tokenService } from '../src/modules/auth/token.service.js';
import { resetDatabase, TEST_PASSWORD } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn } from './parking-helpers.js';
import {
  admin,
  API,
  addVehicle,
  app,
  bearer,
  createParkingUser,
  document,
  errorCode,
  PNG_BYTES,
  portal,
  registration,
} from './user-helpers.js';

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
});

afterAll(disconnectDatabase);

describe('registration and sign-in doors', () => {
  it('registers a Student as PENDING with the category taken from the endpoint only', async () => {
    const res = await request(app)
      .post(`${API}/auth/register/student`)
      .send(
        registration('2BT22CS001', 'asha@college.edu.in', { category: 'STAFF', role: 'ADMIN' }),
      );
    const body = res.body as LoginResponse;

    expect(res.status).toBe(201);
    expect(body.user.role).toBe('PARKING_USER');
    expect(body.user.parkingUser).toEqual({ category: 'STUDENT', verificationStatus: 'PENDING' });
  });

  it('registers Campus Staff through its own endpoint', async () => {
    const res = await request(app)
      .post(`${API}/auth/register/staff`)
      .send(registration('EMP-1042', 'ravi@college.edu.in'));
    expect(res.status).toBe(201);
    expect((res.body as LoginResponse).user.parkingUser?.category).toBe('STAFF');
  });

  it('rejects duplicate e-mail and duplicate ID within the same category', async () => {
    await request(app)
      .post(`${API}/auth/register/student`)
      .send(registration('2BT22CS001', 'asha@college.edu.in'));
    const sameEmail = await request(app)
      .post(`${API}/auth/register/student`)
      .send(registration('2BT22CS002', 'ASHA@college.edu.in'));
    const sameId = await request(app)
      .post(`${API}/auth/register/student`)
      .send(registration('2BT22CS001', 'other@college.edu.in'));
    expect(errorCode(sameEmail.body)).toBe('EMAIL_TAKEN');
    expect(errorCode(sameId.body)).toBe('INSTITUTIONAL_ID_TAKEN');
  });

  it('rejects documents that are not really JPEG, PNG or PDF', async () => {
    const res = await request(app)
      .post(`${API}/auth/register/student`)
      .send(
        registration('2BT22CS001', 'asha@college.edu.in', {
          document: document(Buffer.from('<script>alert(1)</script>'), 'image/png'),
        }),
      );
    expect(res.status).toBe(400);
    expect(errorCode(res.body)).toBe('INVALID_DOCUMENT');
  });

  it('accepts a document of exactly 2 MB and rejects anything larger', async () => {
    const sized = (bytes: number) =>
      Buffer.concat([PNG_BYTES, Buffer.alloc(bytes - PNG_BYTES.length, 7)]);
    const ok = await request(app)
      .post(`${API}/auth/register/student`)
      .send(
        registration('2BT22CS001', 'asha@college.edu.in', {
          document: document(sized(2 * 1024 * 1024)),
        }),
      );
    expect(ok.status).toBe(201);
    const tooBig = await request(app)
      .post(`${API}/auth/register/student`)
      .send(
        registration('2BT22CS002', 'ravi@college.edu.in', {
          document: document(sized(2 * 1024 * 1024 + 1)),
        }),
      );
    expect(tooBig.status).toBe(400);
  });

  it('rejects a mismatching confirmation of the ID', async () => {
    const res = await request(app)
      .post(`${API}/auth/register/student`)
      .send(registration('2BT22CS001', 'asha@college.edu.in', { confirmInstitutionalId: 'X' }));
    expect(res.status).toBe(400);
  });

  it('keeps the two sign-in doors separate', async () => {
    const student = await createParkingUser('STUDENT');
    await signIn('ADMIN', 'boss');
    await signIn('SECURITY_STAFF', 'guard');

    const okUser = await request(app)
      .post(`${API}/auth/user-login`)
      .send({ email: student.email, password: TEST_PASSWORD });
    expect(okUser.status).toBe(200);

    // A parking user cannot use the operational door (by username or e-mail) ...
    for (const username of [student.user.username, student.email]) {
      const res = await request(app)
        .post(`${API}/auth/login`)
        .send({ username, password: TEST_PASSWORD });
      expect(res.status).toBe(401);
      expect(errorCode(res.body)).toBe('INVALID_CREDENTIALS');
    }

    // ... and operational accounts cannot use the parking-user door.
    const adminAsUser = await request(app)
      .post(`${API}/auth/user-login`)
      .send({ email: 'boss', password: TEST_PASSWORD });
    expect(adminAsUser.status).toBe(400);
  });

  it('refuses to sign in a deactivated parking user', async () => {
    const student = await createParkingUser('STUDENT', 'VERIFIED', { isActive: false });
    const res = await request(app)
      .post(`${API}/auth/user-login`)
      .send({ email: student.email, password: TEST_PASSWORD });
    expect(errorCode(res.body)).toBe('ACCOUNT_DISABLED');
  });
});

describe('student identity verification', () => {
  it('keeps a PENDING student out of parking features but lets them see their status', async () => {
    const { token } = await createParkingUser('STUDENT', 'PENDING');
    const p = portal(token);

    const profile = await p.get('/profile');
    expect(profile.status).toBe(200);
    expect((profile.body as ParkingUserProfileView).verification.status).toBe('PENDING');

    for (const path of ['/overview', '/vehicles', '/history', '/receipts', '/layout']) {
      const res = await p.get(path);
      expect(res.status, path).toBe(403);
      expect(errorCode(res.body), path).toBe('VERIFICATION_REQUIRED');
    }
    expect(
      (await p.post('/vehicles', { vehicleNumber: 'KA22AB1234', vehicleType: 'TWO_WHEELER' }))
        .status,
    ).toBe(403);
  });

  it('does not give an unverified Student verified billing at check-in', async () => {
    const pending = await createParkingUser('STUDENT', 'PENDING');
    await prisma.vehicle.create({
      data: {
        vehicleNumber: 'KA22AB1234',
        vehicleType: 'TWO_WHEELER',
        ownerUserId: pending.user.id,
        ownerSince: new Date(),
      },
    });
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);

    const checkIn = (await guard.checkInOk(
      'KA22AB1234',
      'TWO_WHEELER',
      'VISITOR',
    )) as CheckInResponse;
    expect(checkIn.session.ownerCategory).toBe('VISITOR');
    expect(checkIn.categorySource).toBe('OPERATOR');
  });

  it('runs the admin review workflow: reject, resubmit, approve — once', async () => {
    const adminToken = (await signIn('ADMIN', 'boss')).token;
    const registered = await request(app)
      .post(`${API}/auth/register/student`)
      .send(registration('2BT22CS001', 'asha@college.edu.in'));
    const { accessToken, user } = registered.body as LoginResponse;
    const a = admin(adminToken);

    const pendingList = await a.get('/users?kind=STUDENT&verification=PENDING');
    expect((pendingList.body as Page<UserListItem>).items.map((item) => item.id)).toEqual([
      user.id,
    ]);

    const noNote = await a.post(`/users/${user.id}/verification`, { decision: 'REJECT' });
    expect(noNote.status).toBe(400);

    const rejected = await a.post(`/users/${user.id}/verification`, {
      decision: 'REJECT',
      note: 'ID photo is blurred',
    });
    expect(rejected.status).toBe(200);
    expect((rejected.body as UserDetail).verification).toMatchObject({
      status: 'REJECTED',
      note: 'ID photo is blurred',
      reviewedBy: 'ADMIN user',
    });

    // Only a rejected account may resubmit, and it returns to PENDING.
    const resubmit = await portal(accessToken).post('/verification/resubmit', {
      institutionalId: '2BT22CS001',
      confirmInstitutionalId: '2BT22CS001',
      document: document(),
    });
    expect(resubmit.status).toBe(200);
    expect((resubmit.body as ParkingUserProfileView).verification.status).toBe('PENDING');
    const again = await portal(accessToken).post('/verification/resubmit', {
      institutionalId: '2BT22CS001',
      confirmInstitutionalId: '2BT22CS001',
      document: document(),
    });
    expect(errorCode(again.body)).toBe('VERIFICATION_NOT_REJECTED');

    const approved = await a.post(`/users/${user.id}/verification`, { decision: 'VERIFY' });
    expect((approved.body as UserDetail).verification?.status).toBe('VERIFIED');
    expect((approved.body as UserDetail).documents).toHaveLength(2);

    const second = await a.post(`/users/${user.id}/verification`, { decision: 'VERIFY' });
    expect(errorCode(second.body)).toBe('VERIFICATION_NOT_PENDING');

    // The decision applies to the next request with the same token.
    expect((await portal(accessToken).get('/overview')).status).toBe(200);
  });

  it('serves identity documents only to administrators, never anonymously or to others', async () => {
    const student = await createParkingUser('STUDENT', 'PENDING');
    const other = await createParkingUser('STUDENT');
    const adminToken = (await signIn('ADMIN', 'boss')).token;
    const guardToken = (await signIn('SECURITY_STAFF', 'guard')).token;
    const path = `${API}/admin/users/${student.user.id}/documents/${student.documentId}`;

    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get(path).set(bearer(student.token))).status).toBe(403);
    expect((await request(app).get(path).set(bearer(other.token))).status).toBe(403);
    expect((await request(app).get(path).set(bearer(guardToken))).status).toBe(403);

    const res = await request(app).get(path).set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(res.body as Buffer).equals(PNG_BYTES)).toBe(true);

    const viewed = await prisma.auditLog.findMany({
      where: { action: 'IDENTITY_DOCUMENT_VIEWED' },
    });
    expect(viewed).toHaveLength(1);

    // A document id under the wrong user is not found.
    const wrongUser = await request(app)
      .get(`${API}/admin/users/${other.user.id}/documents/${student.documentId}`)
      .set(bearer(adminToken));
    expect(wrongUser.status).toBe(404);

    // No static or public route exposes uploads.
    for (const publicPath of [
      '/uploads/college-id.png',
      `${API}/public/documents/${student.documentId}`,
    ]) {
      expect((await request(app).get(publicPath)).status).toBe(404);
    }
  });

  it('does not expose the document bytes in user details', async () => {
    const student = await createParkingUser('STUDENT', 'PENDING');
    const adminToken = (await signIn('ADMIN', 'boss')).token;
    const res = await admin(adminToken).get(`/users/${student.user.id}`);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(PNG_BYTES.toString('base64'));
    expect(text).not.toContain('passwordHash');
    expect((res.body as UserDetail).documents[0]).toMatchObject({ mimeType: 'image/png' });
  });
});

describe('category cannot be self-assigned', () => {
  it('ignores category, verification and role in profile edits and rejects them as unknown fields', async () => {
    const { token } = await createParkingUser('STUDENT');
    const p = portal(token);

    for (const body of [
      { category: 'STAFF' },
      { verificationStatus: 'VERIFIED' },
      { role: 'ADMIN' },
      { institutionalId: 'EMP-1' },
      { email: 'new@college.edu.in' },
    ]) {
      expect((await p.patch('/profile', body)).status, JSON.stringify(body)).toBe(400);
    }

    const ok = await p.patch('/profile', {
      fullName: 'New Name',
      phone: '9000000001',
      preferredLocale: 'kn',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      fullName: 'New Name',
      phone: '9000000001',
      preferredLocale: 'kn',
      category: 'STUDENT',
    });
  });

  it('bills a verified account by its authoritative category, whatever the guard selects', async () => {
    const student = await createParkingUser('STUDENT');
    const staff = await createParkingUser('STAFF');
    await addVehicle(student.token, 'KA22AB1234');
    await addVehicle(staff.token, 'KA01CD5678');
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);

    // A student's vehicle is never billed as Staff (or Visitor) ...
    const studentCheckIn = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'STAFF');
    expect(studentCheckIn.session.ownerCategory).toBe('STUDENT');
    expect(studentCheckIn.categorySource).toBe('ACCOUNT');
    // ... and a staff vehicle is never billed as Student.
    const staffCheckIn = await guard.checkInOk('KA01CD5678', 'TWO_WHEELER', 'STUDENT');
    expect(staffCheckIn.session.ownerCategory).toBe('STAFF');
    expect(staffCheckIn.categorySource).toBe('ACCOUNT');
  });

  it('still requires an explicit category for vehicles without an account', async () => {
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
    const res = await guard.checkIn({
      vehicleNumber: 'KA22AB9999',
      vehicleType: 'TWO_WHEELER',
      entryHour: 9,
    });
    expect(res.status).toBe(400);
    const ok = await guard.checkInOk('KA22AB9999', 'TWO_WHEELER', 'VISITOR');
    expect(ok.categorySource).toBe('OPERATOR');
  });
});

describe('vehicle ownership', () => {
  it('registers vehicles, makes the first primary, and switches the primary', async () => {
    const { token } = await createParkingUser('STUDENT');
    const first = await addVehicle(token, 'ka-22-ab-1234');
    const second = await addVehicle(token, 'KA01CD5678', 'FOUR_WHEELER');
    expect(first).toMatchObject({ vehicleNumber: 'KA22AB1234', isPrimary: true });
    expect(second.isPrimary).toBe(false);

    const switched = await portal(token).post(`/vehicles/${second.id}/primary`);
    expect(switched.status).toBe(200);
    const list = (await portal(token).get('/vehicles')).body as RegisteredVehicle[];
    expect(
      list.filter((vehicle) => vehicle.isPrimary).map((vehicle) => vehicle.vehicleNumber),
    ).toEqual(['KA01CD5678']);
  });

  it('ignores attempts to set protected fields on registration', async () => {
    const { token, user } = await createParkingUser('STUDENT');
    await addVehicle(token, 'KA22AB1234');
    const res = await portal(token).post('/vehicles', {
      vehicleNumber: 'KA01CD5678',
      vehicleType: 'TWO_WHEELER',
      isPrimary: true,
      ownerUserId: 'someone-else',
      ownerCategory: 'STAFF',
    });
    expect(res.status).toBe(201);
    expect((res.body as RegisteredVehicle).isPrimary).toBe(false);
    expect(
      (await prisma.vehicle.findUniqueOrThrow({ where: { vehicleNumber: 'KA01CD5678' } }))
        .ownerUserId,
    ).toBe(user.id);
  });

  it('rejects duplicates, other users’ vehicles and tampering on edit', async () => {
    const a = await createParkingUser('STUDENT');
    const b = await createParkingUser('STAFF');
    const vehicleA = await addVehicle(a.token, 'KA22AB1234');

    const dup = await portal(b.token).post('/vehicles', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
    });
    expect(errorCode(dup.body)).toBe('VEHICLE_ALREADY_REGISTERED');

    expect(
      (await portal(b.token).patch(`/vehicles/${vehicleA.id}`, { label: 'mine' })).status,
    ).toBe(404);
    expect((await portal(b.token).post(`/vehicles/${vehicleA.id}/primary`)).status).toBe(404);
    expect(
      (
        await portal(a.token).patch(`/vehicles/${vehicleA.id}`, {
          isPrimary: false,
          ownerCategory: 'STAFF',
        })
      ).status,
    ).toBe(400);

    const label = await portal(a.token).patch(`/vehicles/${vehicleA.id}`, { label: 'Scooter' });
    expect((label.body as RegisteredVehicle).label).toBe('Scooter');
    const renumber = await portal(a.token).patch(`/vehicles/${vehicleA.id}`, {
      vehicleNumber: 'KA22AB4321',
    });
    expect((renumber.body as RegisteredVehicle).vehicleNumber).toBe('KA22AB4321');
  });

  it('locks number and type once the vehicle has parking history', async () => {
    const { token } = await createParkingUser('STUDENT');
    const vehicle = await addVehicle(token, 'KA22AB1234');
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
    await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'STUDENT');

    const res = await portal(token).patch(`/vehicles/${vehicle.id}`, {
      vehicleType: 'FOUR_WHEELER',
    });
    expect(errorCode(res.body)).toBe('VEHICLE_IDENTITY_LOCKED');
    const list = (await portal(token).get('/vehicles')).body as RegisteredVehicle[];
    expect(list[0]).toMatchObject({ identityEditable: false });
    expect(list[0]!.activeSession).toMatchObject({ slotCode: expect.stringMatching(/^T-/) });
  });

  it('refuses to claim a vehicle with a different type on record', async () => {
    const { token } = await createParkingUser('STUDENT');
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
    await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR');
    const res = await portal(token).post('/vehicles', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'FOUR_WHEELER',
    });
    expect(errorCode(res.body)).toBe('VEHICLE_TYPE_MISMATCH');
  });
});

describe('a user sees only their own parking', () => {
  it('isolates sessions, history, receipts and the live layout between users', async () => {
    const a = await createParkingUser('STUDENT');
    const b = await createParkingUser('STUDENT');
    await addVehicle(a.token, 'KA22AB1111');
    await addVehicle(b.token, 'KA22AB2222');
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);

    const aSession = await guard.checkInOk('KA22AB1111', 'TWO_WHEELER', 'STUDENT', 8);
    const bSession = await guard.checkInOk('KA22AB2222', 'TWO_WHEELER', 'STUDENT', 9);
    const done = await guard.checkOutOk(aSession.session.sessionNumber, 12);
    const aReceipt = done.receipt!.receiptNumber;
    const aOther = await guard.checkInOk('KA22AB1111', 'TWO_WHEELER', 'STUDENT', 13);
    void aOther;

    // Own data
    const overviewB = (await portal(b.token).get('/overview')).body as PortalOverview;
    expect(overviewB.activeSessions.map((s) => s.vehicleNumber)).toEqual(['KA22AB2222']);
    expect(overviewB.recentActivity.map((s) => s.vehicleNumber)).toEqual(['KA22AB2222']);
    expect(overviewB.vehicleCount).toBe(1);

    // Other users' sessions and receipts look like they do not exist.
    expect((await portal(b.token).get(`/sessions/${aSession.session.sessionNumber}`)).status).toBe(
      404,
    );
    expect((await portal(b.token).get(`/receipts/${aReceipt}`)).status).toBe(404);
    expect((await portal(a.token).get(`/receipts/${aReceipt}`)).status).toBe(200);
    expect((await portal(a.token).get(`/sessions/${bSession.session.sessionNumber}`)).status).toBe(
      404,
    );

    const historyB = (await portal(b.token).get('/history')).body as Page<{
      vehicleNumber: string;
    }>;
    expect(historyB.items.every((item) => item.vehicleNumber === 'KA22AB2222')).toBe(true);
    const receiptsB = (await portal(b.token).get('/receipts')).body as Page<ReceiptView>;
    expect(receiptsB.total).toBe(0);
    const receiptsA = (await portal(a.token).get('/receipts')).body as Page<ReceiptView>;
    expect(receiptsA.items.map((r) => r.receiptNumber)).toEqual([aReceipt]);

    // The live layout reveals only the viewer's own vehicle.
    const layoutB = (await portal(b.token).get('/layout')).body as PortalLayoutResponse;
    const slots = layoutB.blocks.flatMap((block) => block.zones.flatMap((zone) => zone.slots));
    expect(layoutB.mySlots).toEqual([bSession.session.slotCode]);
    expect(
      slots.filter((slot) => slot.occupant).map((slot) => slot.occupant?.vehicleNumber),
    ).toEqual(['KA22AB2222']);
    expect(JSON.stringify(layoutB)).not.toContain('KA22AB1111');
    expect(slots.find((slot) => slot.code === aOther.session.slotCode)?.status).toBe('OCCUPIED');
  });

  it('does not show a vehicle’s earlier history to its new owner', async () => {
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
    const visitor = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 8);
    await guard.checkOutOk(visitor.session.sessionNumber, 10);

    const { token } = await createParkingUser('STUDENT');
    await addVehicle(token, 'KA22AB1234');
    const history = (await portal(token).get('/history')).body as Page<unknown>;
    expect(history.total).toBe(0);
    expect(((await portal(token).get('/receipts')).body as Page<unknown>).total).toBe(0);
    expect((await portal(token).get(`/sessions/${visitor.session.sessionNumber}`)).status).toBe(
      404,
    );
  });

  it('shows live values and finalized values from the backend, with working filters', async () => {
    const { token } = await createParkingUser('STUDENT');
    await addVehicle(token, 'KA22AB1234');
    await addVehicle(token, 'KA01CD5678', 'FOUR_WHEELER');
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);

    const two = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 8);
    await guard.checkInOk('KA01CD5678', 'FOUR_WHEELER', 'VISITOR', 8);
    const done = await guard.checkOutOk(two.session.sessionNumber, 12);

    const history = (await portal(token).get('/history')).body as Page<{
      vehicleNumber: string;
      feePaise: number | null;
      status: string;
    }>;
    expect(history.total).toBe(2);
    const completed = history.items.find((item) => item.status === 'COMPLETED')!;
    expect(completed.feePaise).toBe(done.receipt!.totalPaise);
    expect(completed.feePaise).toBe(2000); // 4h student 2W: 2 free, 2 × ₹10

    const fours = (await portal(token).get('/history?vehicleType=FOUR_WHEELER'))
      .body as Page<unknown>;
    expect(fours.total).toBe(1);
    const byNumber = (await portal(token).get('/history?vehicleNumber=ka01cd'))
      .body as Page<unknown>;
    expect(byNumber.total).toBe(1);
    const future = (await portal(token).get('/history?from=2999-01-01')).body as Page<unknown>;
    expect(future.total).toBe(0);

    const current = (await portal(token).get('/sessions/current')).body as {
      sessionNumber: string;
    }[];
    expect(current).toHaveLength(1);
  });
});

describe('role separation on protected endpoints', () => {
  const OPERATIONAL: [method: 'get' | 'post' | 'patch', path: string][] = [
    ['get', '/dashboard/summary'],
    ['get', '/system/status'],
    ['get', '/parking/map'],
    ['get', '/parking/sessions/active'],
    ['get', '/parking/tracking?q=KA22AB1234'],
    ['get', '/parking/alerts'],
    ['post', '/parking/check-ins'],
    ['post', '/parking/checkouts/quote'],
    ['post', '/parking/payments'],
    ['get', '/parking/receipts/CPVTS-R-2026-00000000'],
    ['get', '/admin/layout'],
    ['get', '/admin/history'],
    ['get', '/admin/analytics'],
    ['get', '/admin/audit-logs'],
    ['get', '/admin/integrity'],
    ['get', '/admin/users'],
    ['get', '/admin/users/counts'],
    ['get', '/admin/visitors'],
    ['post', '/admin/slots/T-01/block'],
  ];

  it.each(OPERATIONAL)('%s %s refuses a Student, Staff and Visitor token', async (method, path) => {
    const student = await createParkingUser('STUDENT');
    const staff = await createParkingUser('STAFF');
    const { token: visitorToken } = tokenService.issueVisitorToken(
      '00000000-0000-4000-8000-000000000000',
    );

    for (const token of [student.token, staff.token]) {
      const res = await request(app)[method](`${API}${path}`).set(bearer(token)).send({});
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    const res = await request(app)[method](`${API}${path}`).set(bearer(visitorToken)).send({});
    expect(res.status).toBe(401);
  });

  it('keeps Security Staff out of user management and the portal', async () => {
    const guardToken = (await signIn('SECURITY_STAFF', 'guard')).token;
    const student = await createParkingUser('STUDENT', 'PENDING');
    const a = admin(guardToken);

    expect((await a.get('/users')).status).toBe(403);
    expect((await a.get(`/users/${student.user.id}`)).status).toBe(403);
    expect(
      (await a.post(`/users/${student.user.id}/verification`, { decision: 'VERIFY' })).status,
    ).toBe(403);
    expect((await a.post(`/users/${student.user.id}/status`, { isActive: false })).status).toBe(
      403,
    );
    expect((await request(app).get(`${API}/portal/profile`).set(bearer(guardToken))).status).toBe(
      403,
    );
    expect(
      (await prisma.parkingUserProfile.findUniqueOrThrow({ where: { userId: student.user.id } }))
        .verificationStatus,
    ).toBe('PENDING');
  });

  it('keeps administrators out of the parking-user portal', async () => {
    const adminToken = (await signIn('ADMIN', 'boss')).token;
    expect((await request(app).get(`${API}/portal/overview`).set(bearer(adminToken))).status).toBe(
      403,
    );
  });

  it('requires sign-in on every portal route', async () => {
    for (const path of [
      '/profile',
      '/overview',
      '/vehicles',
      '/history',
      '/receipts',
      '/layout',
      '/sessions/current',
    ]) {
      expect((await request(app).get(`${API}/portal${path}`)).status, path).toBe(401);
    }
  });
});

describe('visitor access', () => {
  const grant = (vehicleNumber: string, sessionNumber: string) =>
    request(app).post(`${API}/visitor/access`).send({ vehicleNumber, sessionNumber });

  it('lets a visitor see only the session they hold the slip for', async () => {
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
    const mine = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 8);
    const other = await guard.checkInOk('KA01CD5678', 'TWO_WHEELER', 'VISITOR', 8);

    const access = await grant('ka 22 ab 1234', mine.session.sessionNumber);
    expect(access.status).toBe(200);
    const { accessToken, session } = access.body as VisitorAccessResponse;
    expect(session.sessionNumber).toBe(mine.session.sessionNumber);

    const view = await request(app).get(`${API}/visitor/session`).set(bearer(accessToken));
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      vehicleNumber: 'KA22AB1234',
      slotCode: mine.session.slotCode,
    });

    // The layout shows only the visitor's own vehicle.
    const layout = (await request(app).get(`${API}/visitor/layout`).set(bearer(accessToken)))
      .body as PortalLayoutResponse;
    expect(layout.mySlots).toEqual([mine.session.slotCode]);
    expect(JSON.stringify(layout)).not.toContain('KA01CD5678');
    expect(JSON.stringify(layout)).not.toContain(other.session.sessionNumber);
  });

  it('answers every failed attempt the same way', async () => {
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
    const visitor = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 8);
    const student = await createParkingUser('STUDENT');
    await addVehicle(student.token, 'KA01CD5678');
    const students = await guard.checkInOk('KA01CD5678', 'TWO_WHEELER', 'VISITOR', 8);

    const attempts = [
      grant('KA22AB1234', 'CPVTS-P-00000000'), // unknown session
      grant('KA99ZZ9999', visitor.session.sessionNumber), // wrong vehicle
      grant('KA01CD5678', students.session.sessionNumber), // not a visitor session
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(404);
      expect(errorCode(res.body)).toBe('VISITOR_ACCESS_DENIED');
    }
  });

  it('never turns a visitor token into an account token, or an account token into a visitor token', async () => {
    const guardLogin = await signIn('SECURITY_STAFF', 'guard');
    const guard = parkingApi(app, guardLogin.token);
    const visitor = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 8);
    const { accessToken } = (await grant('KA22AB1234', visitor.session.sessionNumber))
      .body as VisitorAccessResponse;

    for (const path of [
      '/auth/me',
      '/portal/profile',
      '/portal/overview',
      '/parking/map',
      '/admin/users',
      '/dashboard/summary',
    ]) {
      expect((await request(app).get(`${API}${path}`).set(bearer(accessToken))).status, path).toBe(
        401,
      );
    }
    const logout = await request(app).post(`${API}/auth/logout`).set(bearer(accessToken));
    expect(logout.status).toBe(401);

    for (const token of [guardLogin.token, (await createParkingUser('STUDENT')).token]) {
      expect((await request(app).get(`${API}/visitor/session`).set(bearer(token))).status).toBe(
        401,
      );
    }
    expect((await request(app).get(`${API}/visitor/session`)).status).toBe(401);
  });

  it('shows the receipt only after the visit is paid', async () => {
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
    const visitor = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 8);
    const { accessToken } = (await grant('KA22AB1234', visitor.session.sessionNumber))
      .body as VisitorAccessResponse;

    const early = await request(app).get(`${API}/visitor/receipt`).set(bearer(accessToken));
    expect(early.status).toBe(404);
    expect(errorCode(early.body)).toBe('RECEIPT_NOT_FOUND');

    const done = await guard.checkOutOk(visitor.session.sessionNumber, 11);
    const receipt = await request(app).get(`${API}/visitor/receipt`).set(bearer(accessToken));
    expect(receipt.status).toBe(200);
    expect((receipt.body as ReceiptView).receiptNumber).toBe(done.receipt!.receiptNumber);
    expect((receipt.body as ReceiptView).totalPaise).toBe(6000); // 3h visitor 2W: 3 × ₹20
  });
});

describe('administrator user management', () => {
  it('lists, counts, edits and deactivates users', async () => {
    const adminLogin = await signIn('ADMIN', 'boss');
    const a = admin(adminLogin.token);
    const student = await createParkingUser('STUDENT', 'PENDING');
    const staff = await createParkingUser('STAFF');
    await createParkingUser('STUDENT', 'VERIFIED');
    await addVehicle(staff.token, 'KA01CD5678');
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
    await guard.checkInOk('KA01CD5678', 'TWO_WHEELER', 'STAFF');
    const visitor = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 9);

    const counts = (await a.get('/users/counts')).body as UserCounts;
    expect(counts).toMatchObject({
      students: 2,
      staff: 1,
      pendingVerification: 1,
      visitorVehicles: 1,
      activeParkingUsers: 1,
    });

    const staffList = (await a.get('/users?kind=STAFF')).body as Page<UserListItem>;
    expect(staffList.items).toHaveLength(1);
    expect(staffList.items[0]).toMatchObject({
      vehicleCount: 1,
      currentParking: { slotCode: expect.stringMatching(/^T-/) },
    });
    const search = (await a.get(`/users?q=${student.institutionalId.toLowerCase()}`))
      .body as Page<UserListItem>;
    expect(search.items.map((item) => item.id)).toEqual([student.user.id]);

    const visitors = (await a.get('/visitors?status=ACTIVE')).body as Page<VisitorListItem>;
    expect(visitors.items.map((item) => item.sessionNumber)).toEqual([
      visitor.session.sessionNumber,
    ]);

    // Permitted edits only; category and role are rejected.
    const edited = await a.patch(`/users/${student.user.id}`, {
      fullName: 'Asha P',
      phone: '9111111111',
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ fullName: 'Asha P', parkingUser: { phone: '9111111111' } });
    expect((await a.patch(`/users/${student.user.id}`, { category: 'STAFF' })).status).toBe(400);
    expect((await a.patch(`/users/${student.user.id}`, { role: 'ADMIN' })).status).toBe(400);
    const taken = await a.patch(`/users/${student.user.id}`, { email: staff.email });
    expect(errorCode(taken.body)).toBe('EMAIL_TAKEN');

    // Deactivation ends the user's session at once and blocks sign-in.
    const off = await a.post(`/users/${staff.user.id}/status`, { isActive: false });
    expect((off.body as UserDetail).isActive).toBe(false);
    expect((await portal(staff.token).get('/profile')).status).toBe(401);
    const login = await request(app)
      .post(`${API}/auth/user-login`)
      .send({ email: staff.email, password: TEST_PASSWORD });
    expect(errorCode(login.body)).toBe('ACCOUNT_DISABLED');
    const on = await a.post(`/users/${staff.user.id}/status`, { isActive: true });
    expect((on.body as UserDetail).isActive).toBe(true);

    const self = await a.post(`/users/${adminLogin.user.id}/status`, { isActive: false });
    expect(errorCode(self.body)).toBe('CANNOT_CHANGE_OWN_STATUS');
  });

  it('shows a user’s vehicles, current parking, history and receipts', async () => {
    const a = admin((await signIn('ADMIN', 'boss')).token);
    const student = await createParkingUser('STUDENT');
    await addVehicle(student.token, 'KA22AB1234');
    const guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
    const first = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'STUDENT', 8);
    await guard.checkOutOk(first.session.sessionNumber, 11);
    await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'STUDENT', 12);

    const detail = (await a.get(`/users/${student.user.id}`)).body as UserDetail;
    expect(detail.vehicles).toHaveLength(1);
    expect(detail.vehicles[0]!.activeSession).not.toBeNull();
    expect(detail.currentParking).not.toBeNull();
    expect(((await a.get(`/users/${student.user.id}/history`)).body as Page<unknown>).total).toBe(
      2,
    );
    expect(((await a.get(`/users/${student.user.id}/receipts`)).body as Page<unknown>).total).toBe(
      1,
    );

    expect((await a.get('/users/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await a.get('/users/not-a-uuid')).status).toBe(400);
  });
});
