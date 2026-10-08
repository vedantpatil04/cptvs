import type {
  Page,
  LoginResponse,
  NotificationsResponse,
  NotificationView,
  ParkNowOffer,
  SendNoticeResponse,
  UserCounts,
  UserDetail,
  UserListItem,
  HistoryItem,
} from '@cpvts/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { resetDatabase, TEST_PASSWORD } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn, slotStatus } from './parking-helpers.js';
import {
  adminAccount,
  client,
  createParkingUser,
  createParkingUserWithVehicle,
  errorCode,
} from './user-helpers.js';

const app = createApp(config);
let admin: ReturnType<typeof client>;
let adminUserId: string;
let guard: ReturnType<typeof parkingApi>;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  const account = await adminAccount();
  adminUserId = account.user.id;
  admin = client(app, account.token);
  guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
});

afterAll(disconnectDatabase);

describe('listing, searching and filtering users', () => {
  const seedPeople = async () => {
    const asha = await createParkingUser({ fullName: 'Asha Patil', institutionalId: '2BT22CS001' });
    const ravi = await createParkingUser({
      fullName: 'Ravi Kulkarni',
      institutionalId: '2BT22EC014',
      verification: 'PENDING',
    });
    const rao = await createParkingUser({
      category: 'STAFF',
      fullName: 'Prof Rao',
      institutionalId: 'EMP-1042',
    });
    const off = await createParkingUser({
      category: 'STAFF',
      fullName: 'Old Staff',
      institutionalId: 'EMP-0007',
      isActive: false,
      verification: 'REJECTED',
    });
    return { asha, ravi, rao, off };
  };
  const list = async (query: Record<string, string | number> = {}) =>
    (await admin.get('/admin/users', query)).body as Page<UserListItem>;

  it('lists everyone with the fields the Users screen shows', async () => {
    const { asha } = await seedPeople();
    await client(app, asha.token).post('/portal/vehicles', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
    });
    const page = await list();
    expect(page.total).toBe(6); // 4 parking users + the administrator + the guard
    const row = page.items.find((item) => item.id === asha.user.id)!;
    expect(row).toMatchObject({
      fullName: 'Asha Patil',
      role: 'PARKING_USER',
      isActive: true,
      vehicleCount: 1,
      currentParking: null,
      parkingUser: {
        category: 'STUDENT',
        institutionalId: '2BT22CS001',
        verificationStatus: 'VERIFIED',
      },
    });
    // Credentials never appear.
    expect(JSON.stringify(page)).not.toMatch(/passwordHash|tokenVersion/);
  });

  it('filters by kind, verification and status', async () => {
    await seedPeople();
    expect((await list({ kind: 'STUDENT' })).total).toBe(2);
    expect((await list({ kind: 'STAFF' })).total).toBe(2);
    expect((await list({ kind: 'STAFF', verification: 'REJECTED' })).total).toBe(1);
    expect((await list({ verification: 'PENDING' })).items.map((i) => i.fullName)).toEqual([
      'Ravi Kulkarni',
    ]);
    expect((await list({ status: 'INACTIVE' })).items.map((i) => i.fullName)).toEqual([
      'Old Staff',
    ]);
    expect((await list({ kind: 'STUDENT', status: 'INACTIVE' })).total).toBe(0);
  });

  it('searches by name, ID and e-mail (partial, case-insensitive)', async () => {
    await seedPeople();
    expect((await list({ q: 'kulkarni' })).items.map((i) => i.fullName)).toEqual(['Ravi Kulkarni']);
    expect((await list({ q: '2bt22' })).total).toBe(2);
    expect((await list({ q: 'EMP-10' })).items.map((i) => i.fullName)).toEqual(['Prof Rao']);
    expect((await list({ q: 'emp-0007@college' })).total).toBe(1);
    expect((await list({ q: 'zzz-nothing' })).total).toBe(0);
  });

  it('paginates', async () => {
    await seedPeople();
    const first = await list({ pageSize: 2, page: 1 });
    const third = await list({ pageSize: 2, page: 3 });
    expect(first.items).toHaveLength(2);
    expect(third.items).toHaveLength(2);
    expect(first.total).toBe(6);
  });

  it('counts students, staff, visitors, pending verification and active parking users', async () => {
    const { asha } = await seedPeople();
    await client(app, asha.token).post('/portal/vehicles', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
    });
    await guard.checkInOk('KA22AB1234'); // the student's scooter, entered by the desk
    await guard.checkInOk('MH12CD5678', 'FOUR_WHEELER', 'VISITOR', 9);
    await guard.checkInOk('MH12ZZ0001', 'TWO_WHEELER', 'VISITOR', 9);

    const counts = (await admin.get('/admin/users/counts')).body as UserCounts;
    expect(counts).toEqual({
      all: 6,
      students: 2,
      staff: 2,
      pendingVerification: 1,
      visitorVehicles: 2,
      activeParkingUsers: 1,
      activeVisitors: 2,
    });

    const row = (await list({ q: 'asha' })).items[0]!;
    expect(row.currentParking).toMatchObject({ vehicleNumber: 'KA22AB1234', slotCode: 'T-01' });
  });
});

describe('user detail', () => {
  it('shows the profile, verification, documents (metadata), vehicles and current parking', async () => {
    const { user, token } = await createParkingUser({ fullName: 'Asha Patil' });
    const portal = client(app, token);
    const vehicle = (
      await portal.post('/portal/vehicles', {
        vehicleNumber: 'KA22AB1234',
        vehicleType: 'TWO_WHEELER',
      })
    ).body as { id: string };
    await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id });
    const offer = (await portal.get('/portal/park-now/offer')).body as { offer: ParkNowOffer };
    await portal.post('/portal/park-now/confirm', { offerId: offer.offer.offerId });

    const res = await admin.get(`/admin/users/${user.id}`);
    expect(res.status).toBe(200);
    const detail = res.body as UserDetail;
    expect(detail).toMatchObject({
      fullName: 'Asha Patil',
      parkingUser: { category: 'STUDENT', verificationStatus: 'VERIFIED' },
      verification: { status: 'VERIFIED' },
      vehicleCount: 1,
      currentParking: { vehicleNumber: 'KA22AB1234', slotCode: 'T-01' },
    });
    expect(detail.documents).toHaveLength(1);
    expect(detail.documents[0]).toMatchObject({
      mimeType: 'image/png',
      institutionalId: '2BT22CS001',
    });
    expect(detail.vehicles[0]).toMatchObject({ vehicleNumber: 'KA22AB1234', isPrimary: true });
    expect(detail.activeSessions).toHaveLength(1);
    expect(detail.activeSessions[0]).toMatchObject({ status: 'ACTIVE', slotCode: 'T-01' });

    const history = (await admin.get(`/admin/users/${user.id}/history`)).body as Page<HistoryItem>;
    expect(history.items.map((i) => i.vehicleNumber)).toEqual(['KA22AB1234']);
  });

  it('returns 404 for an unknown user and 400 for a malformed id', async () => {
    expect(errorCode(await admin.get('/admin/users/00000000-0000-4000-8000-000000000000'))).toBe(
      'USER_NOT_FOUND',
    );
    expect((await admin.get('/admin/users/not-a-uuid')).status).toBe(400);
  });
});

describe('editing a user', () => {
  it('corrects name, e-mail and phone, and audits the change', async () => {
    const { user } = await createParkingUser();
    const res = await admin.patch(`/admin/users/${user.id}`, {
      fullName: 'Asha R Patil',
      email: 'Asha.R@College.edu.in',
      phone: '98450 11111',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fullName: 'Asha R Patil',
      parkingUser: { email: 'asha.r@college.edu.in', phone: '9845011111' },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'USER_UPDATED' } });
    expect(audit).toMatchObject({ actorId: adminUserId, entityId: user.id });
    expect(audit.metadata).toMatchObject({ fields: ['fullName', 'email', 'phone'] });
  });

  it('cannot edit category, role, ID or credentials', async () => {
    const { user } = await createParkingUser();
    for (const body of [
      { category: 'STAFF' },
      { role: 'ADMIN' },
      { institutionalId: 'EMP-1' },
      { password: 'a-new-password-1' },
      { verificationStatus: 'VERIFIED' },
    ]) {
      expect(
        (await admin.patch(`/admin/users/${user.id}`, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    expect((await admin.patch(`/admin/users/${user.id}`, {})).status).toBe(200);
  });

  it('keeps e-mail addresses unique', async () => {
    const a = await createParkingUser({ institutionalId: '2BT22CS001' });
    await createParkingUser({ institutionalId: '2BT22CS002', email: 'taken@college.edu.in' });
    const res = await admin.patch(`/admin/users/${a.user.id}`, { email: 'TAKEN@college.edu.in' });
    expect(errorCode(res)).toBe('EMAIL_TAKEN');
  });

  it('does not give operational accounts an e-mail or phone', async () => {
    const res = await admin.patch(`/admin/users/${adminUserId}`, { phone: '9845011111' });
    expect(res.status).toBe(400);
    expect(
      (await admin.patch(`/admin/users/${adminUserId}`, { fullName: 'Chief Admin' })).status,
    ).toBe(200);
  });
});

describe('activating and deactivating', () => {
  it('deactivation takes effect immediately and can be reversed', async () => {
    const { user, token } = await createParkingUser();
    const portal = client(app, token);
    expect((await portal.get('/portal/profile')).status).toBe(200);

    const off = await admin.post(`/admin/users/${user.id}/status`, { isActive: false });
    expect(off.status).toBe(200);
    expect((off.body as UserDetail).isActive).toBe(false);
    expect((await portal.get('/portal/profile')).status).toBe(401);
    const login = await client(app).post('/auth/user-login', {
      email: '2bt22cs001@college.edu.in',
      password: TEST_PASSWORD,
    });
    expect(errorCode(login)).toBe('ACCOUNT_DISABLED');

    const on = await admin.post(`/admin/users/${user.id}/status`, { isActive: true });
    expect((on.body as UserDetail).isActive).toBe(true);
    const relogin = await client(app).post('/auth/user-login', {
      email: '2bt22cs001@college.edu.in',
      password: TEST_PASSWORD,
    });
    expect(relogin.status).toBe(200);
    expect((relogin.body as LoginResponse).user.parkingUser?.verificationStatus).toBe('VERIFIED');

    const actions = (await prisma.auditLog.findMany({ where: { entityId: user.id } })).map(
      (e) => e.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['USER_DEACTIVATED', 'USER_ACTIVATED']));
  });

  it('releases a slot the user was holding for Park Now', async () => {
    const { user, token, vehicle } = await createParkingUserWithVehicle(app);
    await client(app, token).post('/portal/park-now/offers', { vehicleId: vehicle.id });
    expect(await slotStatus('T-01')).toBe('HELD');

    await admin.post(`/admin/users/${user.id}/status`, { isActive: false });
    expect(await slotStatus('T-01')).toBe('AVAILABLE');
    expect(await prisma.parkNowOffer.count({ where: { status: 'OFFERED' } })).toBe(0);
  });

  it('does not let an administrator deactivate themselves', async () => {
    const res = await admin.post(`/admin/users/${adminUserId}/status`, { isActive: false });
    expect(errorCode(res)).toBe('CANNOT_CHANGE_OWN_STATUS');
  });

  it('can deactivate security staff but they keep no access afterwards', async () => {
    const security = await signIn('SECURITY_STAFF', 'guard5');
    await admin.post(`/admin/users/${security.user.id}/status`, { isActive: false });
    expect((await client(app, security.token).get('/parking/map')).status).toBe(401);
  });
});

describe('visitors', () => {
  it('lists visitors from their parking sessions', async () => {
    const a = await guard.checkInOk('MH12CD5678', 'FOUR_WHEELER', 'VISITOR', 9);
    await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'STUDENT', 9);
    await guard.checkOutOk(a.session.sessionNumber, 11);
    await guard.checkInOk('MH12ZZ0001', 'TWO_WHEELER', 'VISITOR', 10);

    const all = (await admin.get('/admin/visitors')).body as Page<HistoryItem>;
    expect(all.total).toBe(2);
    expect(all.items.every((i) => i.ownerCategory === 'VISITOR')).toBe(true);

    const active = (await admin.get('/admin/visitors', { status: 'ACTIVE' }))
      .body as Page<HistoryItem>;
    expect(active.items.map((i) => i.vehicleNumber)).toEqual(['MH12ZZ0001']);
    const search = (await admin.get('/admin/visitors', { vehicleNumber: 'mh12cd' }))
      .body as Page<HistoryItem>;
    expect(search.items[0]).toMatchObject({
      vehicleNumber: 'MH12CD5678',
      feePaise: 8000,
    });
    // A visitor-only list cannot be widened to other categories.
    const forced = (await admin.get('/admin/visitors', { ownerCategory: 'STUDENT' }))
      .body as Page<HistoryItem>;
    expect(forced.items.every((i) => i.ownerCategory === 'VISITOR')).toBe(true);
  });
});

describe('notifications', () => {
  const notices = async (token: string, query: Record<string, string | number | boolean> = {}) =>
    (await client(app, token).get('/portal/notifications', query)).body as NotificationsResponse;

  it('lists newest first, tracks unread, and marks read one by one or all at once', async () => {
    const { user, token } = await createParkingUser({ verification: 'PENDING' });
    await admin.post(`/admin/users/${user.id}/verification`, { decision: 'VERIFY' });
    await admin.post('/admin/notices', {
      audience: 'ALL',
      title: 'Gate B closed',
      message: 'Use gate A today.',
    });
    await admin.post('/admin/notices', {
      audience: 'ALL',
      title: 'Rain alert',
      message: 'Park under cover.',
    });

    const all = await notices(token);
    expect(all.unreadCount).toBe(3);
    expect(all.items.map((n) => n.kind)).toEqual([
      'PARKING_NOTICE',
      'PARKING_NOTICE',
      'VERIFICATION_APPROVED',
    ]);
    expect(all.items[0]?.params).toMatchObject({
      title: 'Rain alert',
      message: 'Park under cover.',
    });

    const one = await client(app, token).post(`/portal/notifications/${all.items[0]!.id}/read`);
    expect((one.body as NotificationView).readAt).not.toBeNull();
    // Marking again is harmless and keeps the original time.
    const again = await client(app, token).post(`/portal/notifications/${all.items[0]!.id}/read`);
    expect((again.body as NotificationView).readAt).toBe((one.body as NotificationView).readAt);

    expect((await notices(token)).unreadCount).toBe(2);
    expect((await notices(token, { unreadOnly: true })).items).toHaveLength(2);
    expect((await notices(token, { limit: 1 })).items).toHaveLength(1);

    const readAll = await client(app, token).post('/portal/notifications/read-all');
    expect(readAll.body).toEqual({ updated: 2 });
    expect((await notices(token)).unreadCount).toBe(0);
  });

  it("never shows or changes another user's notifications", async () => {
    const a = await createParkingUser({ institutionalId: '2BT22CS001' });
    const b = await createParkingUser({ institutionalId: '2BT22CS002' });
    await admin.post('/admin/notices', {
      audience: 'USER',
      userId: a.user.id,
      title: 'Only for A',
      message: 'Hello A',
    });
    const mine = await notices(a.token);
    expect(mine.items).toHaveLength(1);
    expect((await notices(b.token)).items).toHaveLength(0);

    const res = await client(app, b.token).post(`/portal/notifications/${mine.items[0]!.id}/read`);
    expect(errorCode(res)).toBe('NOTIFICATION_NOT_FOUND');
    expect((await notices(a.token)).unreadCount).toBe(1);
    expect((await client(app, b.token).post('/portal/notifications/read-all')).body).toEqual({
      updated: 0,
    });
    expect((await notices(a.token)).unreadCount).toBe(1);
  });

  it('delivers an admin notice to the chosen audience of verified, active users only', async () => {
    const student = await createParkingUser({ institutionalId: '2BT22CS001' });
    const staff = await createParkingUser({ category: 'STAFF', institutionalId: 'EMP-1042' });
    const pending = await createParkingUser({
      institutionalId: '2BT22CS002',
      verification: 'PENDING',
    });
    const inactive = await createParkingUser({ institutionalId: '2BT22CS003', isActive: false });
    const send = async (body: object) =>
      (await admin.post('/admin/notices', body)).body as SendNoticeResponse;

    expect(await send({ audience: 'STUDENTS', title: 'Hi', message: 'students' })).toEqual({
      delivered: 1,
    });
    expect(await send({ audience: 'STAFF', title: 'Hi', message: 'staff' })).toEqual({
      delivered: 1,
    });
    expect(await send({ audience: 'ALL', title: 'Hi', message: 'everyone' })).toEqual({
      delivered: 2,
    });
    expect(
      await send({ audience: 'USER', userId: pending.user.id, title: 'Hi', message: 'x' }),
    ).toEqual({ delivered: 1 });

    expect((await notices(student.token)).items).toHaveLength(2);
    expect((await notices(staff.token)).items).toHaveLength(2);
    expect(await prisma.notification.count({ where: { userId: inactive.user.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'NOTICE_SENT' } })).toBe(4);
  });

  it('validates notices and is for administrators only', async () => {
    expect(
      (await admin.post('/admin/notices', { audience: 'USER', title: 'x', message: 'y' })).status,
    ).toBe(400);
    expect(
      (await admin.post('/admin/notices', { audience: 'ALL', title: '', message: 'y' })).status,
    ).toBe(400);
    expect(
      (await admin.post('/admin/notices', { audience: 'NOBODY', title: 'x', message: 'y' })).status,
    ).toBe(400);

    const { token } = await createParkingUser();
    const body = { audience: 'ALL', title: 'x', message: 'y' };
    expect((await client(app, token).post('/admin/notices', body)).status).toBe(403);
    expect(
      (
        await client(app, (await signIn('SECURITY_STAFF', 'guard6')).token).post(
          '/admin/notices',
          body,
        )
      ).status,
    ).toBe(403);
    expect((await client(app).post('/admin/notices', body)).status).toBe(401);
  });
});
