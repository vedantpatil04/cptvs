import type {
  MarkAllReadResponse,
  NotificationsResponse,
  NotificationView,
  ReceiptVerificationResponse,
} from '@cpvts/shared';
import request from 'supertest';
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
let admin: Awaited<ReturnType<typeof adminAccount>>;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  admin = await adminAccount();
});

afterAll(disconnectDatabase);

describe('public endpoints expose only safe aggregate information', () => {
  it('reveals no person, vehicle, session, payment, receipt, shift, cash or audit detail', async () => {
    const guard = await signIn('SECURITY_STAFF', 'night.guard');
    const api = parkingApi(app, guard.token);
    const student = await createParkingUserWithVehicle(app, {
      fullName: 'Asha Patil',
      institutionalId: '2BT22CS001',
      vehicleNumber: 'KA22AB1234',
    });
    const parked = await api.checkInOk(student.vehicle.vehicleNumber, 'TWO_WHEELER', 'STUDENT', 9);
    const left = await api.checkInOk('KA01CD5678', 'TWO_WHEELER', 'VISITOR', 9);
    const done = await api.checkOutOk(left.session.sessionNumber, 14, 'CASH');
    await client(app, admin.token).post('/admin/notices', {
      audience: 'ALL',
      title: 'Gate closed',
      message: 'The north gate is closed today.',
    });

    const overview = await request(app).get('/api/v1/public/overview');
    expect(overview.status).toBe(200);
    expect(Object.keys(overview.body as object).sort()).toEqual([
      'availability',
      'feeSchedule',
      'generatedAt',
      'locations',
    ]);
    const secrets = [
      'Asha Patil',
      'asha',
      '2BT22CS001',
      'KA22AB1234',
      'KA01CD5678',
      parked.session.sessionNumber,
      parked.session.entryReference!,
      parked.session.slotCode,
      done.payment.transactionId,
      done.receipt!.receiptNumber,
      done.receipt!.verificationReference,
      'night.guard',
      'Main Gate',
      'Test shift',
      'boss',
      'Gate closed',
      'CASH',
      'IDENTITY_',
      'SHIFT_',
    ];
    const text = JSON.stringify(overview.body);
    for (const secret of secrets) expect(text, secret).not.toContain(secret);
  });

  it('lets a receipt be checked from its secret QR reference only, with a masked plate', async () => {
    const guard = await signIn('SECURITY_STAFF', 'guard');
    const api = parkingApi(app, guard.token);
    const entry = await api.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 9);
    const { receipt } = await api.checkOutOk(entry.session.sessionNumber, 14, 'CASH');

    const res = await request(app).get(`/api/v1/public/receipts/${receipt!.verificationReference}`);
    expect(res.status).toBe(200);
    const body = res.body as ReceiptVerificationResponse;
    expect(Object.keys(body.receipt).sort()).toEqual([
      'amountPaise',
      'blockName',
      'durationHours',
      'isSimulated',
      'issuedAt',
      'paymentStatus',
      'receiptNumber',
      'slotCode',
      'vehicleNumber',
    ]);
    expect(body.receipt.vehicleNumber).toBe('KA****1234');
    const text = JSON.stringify(res.body);
    for (const secret of [
      'KA22AB1234',
      entry.session.sessionNumber,
      entry.session.entryReference!,
      'guard',
      'CASH',
    ]) {
      expect(text, secret).not.toContain(secret);
    }

    // The receipt number printed on the receipt is not a key to it.
    expect(
      (await request(app).get(`/api/v1/public/receipts/${receipt!.receiptNumber}`)).status,
    ).toBe(400);
    expect((await request(app).get(`/api/v1/public/receipts/${'B'.repeat(43)}`)).status).toBe(404);
  });

  it('has no other public route', async () => {
    for (const path of [
      '/public/sessions',
      '/public/vehicles',
      '/public/users',
      '/public/revenue',
      '/public/payments',
      '/public/receipts',
      '/public/shifts',
      '/public/cash',
      '/public/audit-logs',
      '/public/map',
    ]) {
      expect((await request(app).get(`/api/v1${path}`)).status, path).toBe(404);
    }
    // The probes say only that the service is up.
    expect(Object.keys((await request(app).get('/health')).body as object).sort()).toEqual([
      'status',
      'timestamp',
    ]);
  });

  it('does not advertise the server and sends the usual security headers', async () => {
    const res = await request(app).get('/api/v1/public/overview');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});

describe('notifications belong to their owner, whatever the role', () => {
  const make = (
    userId: string,
    kind: string,
    params: Record<string, string | number> = {},
    readAt: Date | null = null,
  ) => prisma.notification.create({ data: { userId, kind, params, readAt } });

  it('lets Security Staff and administrators list, filter and read their own', async () => {
    const guard = await signIn('SECURITY_STAFF', 'guard');
    await make(guard.user.id, 'SHIFT_ASSIGNED', { shiftName: 'Morning' });
    await make(guard.user.id, 'PARKING_NOTICE', { title: 'Hi', message: 'There' }, new Date());
    await make(admin.user.id, 'CASH_DISCREPANCY', { differencePaise: -1000 });

    const mine = client(app, guard.token);
    const all = (await mine.get('/notifications')).body as NotificationsResponse;
    expect(all.items).toHaveLength(2);
    expect(all.unreadCount).toBe(1);
    const unread = (await mine.get('/notifications', { unreadOnly: true }))
      .body as NotificationsResponse;
    expect(unread.items.map((n) => n.kind)).toEqual(['SHIFT_ASSIGNED']);
    expect(
      ((await mine.get('/notifications', { limit: 1 })).body as NotificationsResponse).items,
    ).toHaveLength(1);

    const read = await mine.post(`/notifications/${unread.items[0]!.id}/read`);
    expect(read.status).toBe(200);
    expect((read.body as NotificationView).readAt).not.toBeNull();
    expect(((await mine.get('/notifications')).body as NotificationsResponse).unreadCount).toBe(0);

    const boss = (await client(app, admin.token).get('/notifications'))
      .body as NotificationsResponse;
    expect(boss.items.map((n) => n.kind)).toEqual(['CASH_DISCREPANCY']);
    expect(boss.items[0]?.params).toMatchObject({ differencePaise: -1000 });
  });

  it('never shows, reads or changes another person’s notifications', async () => {
    const guard = await signIn('SECURITY_STAFF', 'guard');
    const student = await createParkingUser();
    const theirs = await make(student.user.id, 'VERIFICATION_APPROVED');
    await make(guard.user.id, 'SHIFT_ASSIGNED');

    expect(errorCode(await client(app, guard.token).post(`/notifications/${theirs.id}/read`))).toBe(
      'NOTIFICATION_NOT_FOUND',
    );
    expect(errorCode(await client(app, admin.token).post(`/notifications/${theirs.id}/read`))).toBe(
      'NOTIFICATION_NOT_FOUND',
    );
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt,
    ).toBeNull();

    const marked = (await client(app, guard.token).post('/notifications/read-all'))
      .body as MarkAllReadResponse;
    expect(marked).toEqual({ updated: 1 });
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt,
    ).toBeNull(); // the student’s own is untouched
  });

  it('is the same list a student gets from the portal route', async () => {
    const student = await createParkingUser();
    await make(student.user.id, 'VERIFICATION_APPROVED');
    const viaPortal = (await client(app, student.token).get('/portal/notifications'))
      .body as NotificationsResponse;
    const generic = (await client(app, student.token).get('/notifications'))
      .body as NotificationsResponse;
    expect(generic).toEqual(viaPortal);
  });

  it('needs an account token', async () => {
    expect((await client(app).get('/notifications')).status).toBe(401);
    expect((await client(app, 'not-a-token').get('/notifications')).status).toBe(401);
  });
});
