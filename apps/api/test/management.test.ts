import type {
  AnalyticsResponse,
  ApiErrorBody,
  AuditLogEntry,
  CheckInResponse,
  HistoryItem,
  IntegrityReport,
  ManagedLayout,
  Page,
  SessionTimelineResponse,
} from '@cpvts/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { addCampusDays, campusDateString } from '../src/lib/campus-time.js';
import { analyticsService } from '../src/modules/management/analytics.service.js';
import { alertsService } from '../src/modules/parking/alerts.service.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn, slotStatus } from './parking-helpers.js';

const app = createApp(config);
let staff: ReturnType<typeof parkingApi>;
let adminToken: string;
let staffToken: string;

const admin = {
  get: (path: string, query: Record<string, string | number> = {}) =>
    request(app)
      .get(`/api/v1/admin${path}`)
      .query(query)
      .set('Authorization', `Bearer ${adminToken}`),
  post: (path: string, body: object = {}) =>
    request(app)
      .post(`/api/v1/admin${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body),
  patch: (path: string, body: object) =>
    request(app)
      .patch(`/api/v1/admin${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body),
};
const errorCode = (res: { body: unknown }) => (res.body as ApiErrorBody).error.code;
const today = () => campusDateString();

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  staffToken = (await signIn('SECURITY_STAFF', 'guard')).token;
  adminToken = (await signIn('ADMIN', 'boss')).token;
  staff = parkingApi(app, staffToken);
});

afterAll(disconnectDatabase);

/** Student 2W 09→13 (₹20) and Visitor 4W 10→12 (₹80) completed; one 2W still parked from 11. */
const seedLifecycle = async () => {
  const a = await staff.checkInOk('KA22AB1234', 'TWO_WHEELER', 'STUDENT', 9);
  const b = await staff.checkInOk('MH12CD5678', 'FOUR_WHEELER', 'VISITOR', 10);
  const c = await staff.checkInOk('KA01EF0001', 'TWO_WHEELER', 'STAFF', 11);
  const ra = await staff.checkOutOk(a.session.sessionNumber, 13);
  const rb = await staff.checkOutOk(b.session.sessionNumber, 12);
  return { a, b, c, receiptA: ra.receipt!, receiptB: rb.receipt! };
};

describe('admin access', () => {
  it.each(['/layout', '/history', '/reports/history', '/analytics', '/integrity', '/audit-logs'])(
    'GET %s is for administrators only',
    async (path) => {
      expect((await request(app).get(`/api/v1/admin${path}`)).status).toBe(401);
      const res = await request(app)
        .get(`/api/v1/admin${path}`)
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res.status).toBe(403);
    },
  );

  it('slot management actions are for administrators only', async () => {
    const res = await request(app)
      .post('/api/v1/admin/slots/T-01/block')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reason: 'Maintenance' });
    expect(res.status).toBe(403);
    expect(await slotStatus('T-01')).toBe('AVAILABLE');
  });
});

describe('slot management', () => {
  it('blocks an available slot with a reason, excludes it from allocation, and unblocks it', async () => {
    const blocked = await admin.post('/slots/t-01/block', { reason: 'Maintenance' });
    expect(blocked.status).toBe(200);
    expect(blocked.body).toMatchObject({
      code: 'T-01',
      status: 'BLOCKED',
      priority: 0,
      blockedReason: 'Maintenance',
      isEnabled: true,
    });
    expect((await staff.checkInOk('KA01AB0001')).session.slotCode).toBe('T-02');

    const unblocked = await admin.post('/slots/T-01/unblock');
    expect(unblocked.body).toMatchObject({ status: 'AVAILABLE', blockedReason: null });
    expect((await staff.checkInOk('KA01AB0002')).session.slotCode).toBe('T-01');

    const actions = (await prisma.auditLog.findMany({ where: { entityId: 'T-01' } })).map(
      (e) => e.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['SLOT_BLOCKED', 'SLOT_UNBLOCKED']));
  });

  it('refuses to block an occupied slot or unblock one that is not blocked', async () => {
    await staff.checkInOk('KA01AB0001');
    const occupied = await admin.post('/slots/T-01/block', { reason: 'Maintenance' });
    expect(occupied.status).toBe(409);
    expect(errorCode(occupied)).toBe('SLOT_NOT_AVAILABLE');
    expect(await slotStatus('T-01')).toBe('OCCUPIED');

    expect(errorCode(await admin.post('/slots/T-02/unblock'))).toBe('SLOT_NOT_BLOCKED');
    expect(errorCode(await admin.post('/slots/Z-99/block', { reason: 'x' }))).toBe(
      'SLOT_NOT_FOUND',
    );
    expect(errorCode(await admin.post('/slots/T-02/block', { reason: '  ' }))).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('sets slot priority used by allocation, within 0–100', async () => {
    const res = await admin.patch('/slots/T-08/priority', { priority: 10 });
    expect(res.body).toMatchObject({ code: 'T-08', priority: 10 });
    expect((await staff.checkInOk('KA01AB0001')).session.slotCode).toBe('T-08');
    expect(errorCode(await admin.patch('/slots/T-08/priority', { priority: 101 }))).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('sets and clears real block coordinates; both or neither', async () => {
    const set = await admin.patch('/blocks/BLOCK-2W/location', {
      latitude: 15.8497,
      longitude: 74.4977,
    });
    expect(set.body.coordinates).toEqual({ latitude: 15.8497, longitude: 74.4977 });
    const overview = await request(app).get('/api/v1/public/overview');
    expect(overview.body.locations[0].coordinates).toEqual({
      latitude: 15.8497,
      longitude: 74.4977,
    });

    const unpaired = await admin.patch('/blocks/BLOCK-2W/location', {
      latitude: 15.8,
      longitude: null,
    });
    expect((unpaired.body as ApiErrorBody).error.details).toContainEqual({
      path: 'body.longitude',
      message: 'validation.coordinatesPaired',
    });
    expect(
      errorCode(await admin.patch('/blocks/BLOCK-2W/location', { latitude: 91, longitude: 0 })),
    ).toBe('VALIDATION_ERROR');

    const cleared = await admin.patch('/blocks/BLOCK-2W/location', {
      latitude: null,
      longitude: null,
    });
    expect(cleared.body.coordinates).toBeNull();
    expect(
      errorCode(await admin.patch('/blocks/NOPE/location', { latitude: null, longitude: null })),
    ).toBe('BLOCK_NOT_FOUND');
  });

  it('returns the managed layout', async () => {
    await admin.post('/slots/F-05/block', { reason: 'Repairs' });
    const layout = (await admin.get('/layout')).body as ManagedLayout;
    expect(layout.blocks.map((b) => b.code)).toEqual(['BLOCK-2W', 'BLOCK-4W']);
    const f05 = layout.blocks[1]!.zones[0]!.slots.find((s) => s.code === 'F-05');
    expect(f05).toMatchObject({
      code: 'F-05',
      status: 'BLOCKED',
      priority: 0,
      blockedReason: 'Repairs',
      isEnabled: true,
      archivedAt: null,
      occupant: null,
    });
  });
});

describe('parking history', () => {
  it('lists sessions newest first with final values from the transaction', async () => {
    const { receiptA } = await seedLifecycle();
    const page = (await admin.get('/history')).body as Page<HistoryItem>;
    expect(page.total).toBe(3);
    const a = page.items.find((item) => item.vehicleNumber === 'KA22AB1234')!;
    expect(a).toMatchObject({
      status: 'COMPLETED',
      slotCode: 'T-01',
      entryHour: 9,
      exitHour: 13,
      durationHours: 4,
      feePaise: 2000,
      receiptNumber: receiptA.receiptNumber,
      transactionId: receiptA.payment.transactionId,
      paymentStatus: 'PAID',
    });
    const active = page.items.find((item) => item.vehicleNumber === 'KA01EF0001')!;
    expect(active).toMatchObject({ status: 'ACTIVE', feePaise: null, receiptNumber: null });
  });

  it.each([
    [{ vehicleNumber: 'ka22' }, ['KA22AB1234']],
    [{ slotCode: 'f-01' }, ['MH12CD5678']],
    [{ status: 'ACTIVE' }, ['KA01EF0001']],
    [{ vehicleType: 'FOUR_WHEELER' }, ['MH12CD5678']],
    [{ ownerCategory: 'STUDENT' }, ['KA22AB1234']],
  ])('filters by %j', async (filter, expected) => {
    await seedLifecycle();
    const page = (await admin.get('/history', filter)).body as Page<HistoryItem>;
    expect(page.items.map((item) => item.vehicleNumber)).toEqual(expected);
  });

  it('filters by campus date and paginates', async () => {
    await seedLifecycle();
    expect(
      ((await admin.get('/history', { from: today(), to: today() })).body as Page<HistoryItem>)
        .total,
    ).toBe(3);
    const yesterday = addCampusDays(today(), -1);
    expect(((await admin.get('/history', { to: yesterday })).body as Page<HistoryItem>).total).toBe(
      0,
    );

    const page = (await admin.get('/history', { page: 2, pageSize: 2 })).body as Page<HistoryItem>;
    expect(page).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page.items).toHaveLength(1);
  });

  it('validates date ranges', async () => {
    const reversed = await admin.get('/history', { from: today(), to: addCampusDays(today(), -1) });
    expect((reversed.body as ApiErrorBody).error.details).toContainEqual({
      path: 'query.to',
      message: 'validation.invalidDateRange',
    });
    expect(errorCode(await admin.get('/history', { from: '2026-02-30' }))).toBe('VALIDATION_ERROR');
    expect(errorCode(await admin.get('/history', { from: '2024-01-01', to: '2026-01-01' }))).toBe(
      'DATE_RANGE_TOO_LARGE',
    );
  });
});

describe('CSV reports', () => {
  const csvRows = (text: string) =>
    text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');

  it('exports parking history with authoritative values', async () => {
    const { receiptA } = await seedLifecycle();
    const res = await admin.get('/reports/history');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="cpvts-history-.*\.csv"/,
    );
    const rows = csvRows(res.text);
    expect(rows[0]).toBe(
      'Receipt Number,Session Number,Vehicle Number,Vehicle Type,Owner Category,Parking Block,Slot,Entry Hour,Exit Hour,Duration (hours),Fee (INR),Payment Status,Transaction ID,Session Status,Entry Time,Transaction Date',
    );
    expect(rows).toHaveLength(4);
    const line = rows.find((row) => row.startsWith(receiptA.receiptNumber))!;
    expect(line).toContain(
      ',KA22AB1234,TWO_WHEELER,STUDENT,Two-Wheeler Parking Block,T-01,9,13,4,20.00,PAID,',
    );
    expect(
      await prisma.auditLog.count({ where: { action: 'REPORT_EXPORTED', entityId: 'history' } }),
    ).toBe(1);
  });

  it('exports transactions including failed test payments', async () => {
    const parked = await staff.checkInOk('KA01AB0001', 'TWO_WHEELER', 'VISITOR', 9);
    const created = await staff.createPayment({
      sessionNumber: parked.session.sessionNumber,
      exitHour: 10,
      method: 'CARD',
    });
    await staff.process(created.body.payment.id, {
      sessionNumber: parked.session.sessionNumber,
      outcome: 'FAILURE',
    });
    await staff.checkOutOk(parked.session.sessionNumber, 10, 'CASH');

    const rows = csvRows((await admin.get('/reports/transactions')).text);
    expect(rows).toHaveLength(3);
    expect(rows.some((row) => row.includes(',FAILED,CARD,20.00,yes,'))).toBe(true);
    expect(rows.some((row) => row.includes(',PAID,CASH,20.00,yes,'))).toBe(true);
  });

  it('exports daily revenue from finalized receipts only', async () => {
    await seedLifecycle();
    const rows = csvRows(
      (await admin.get('/reports/revenue', { from: addCampusDays(today(), -1), to: today() })).text,
    );
    expect(rows[0]).toBe(
      'Date,Transactions,Revenue (INR),TWO_WHEELER (INR),FOUR_WHEELER (INR),STAFF (INR),STUDENT (INR),VISITOR (INR)',
    );
    expect(rows[1]).toBe(`${addCampusDays(today(), -1)},0,0.00,0.00,0.00,0.00,0.00,0.00`);
    expect(rows[2]).toBe(`${today()},2,100.00,20.00,80.00,0.00,20.00,80.00`);
  });

  it('exports vehicle records', async () => {
    await seedLifecycle();
    const rows = csvRows((await admin.get('/reports/vehicles')).text);
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.startsWith('KA01EF0001'))).toContain(',TWO_WHEELER,');
    expect(rows.find((row) => row.startsWith('KA01EF0001'))).toContain(',1,yes,');
  });

  it('neutralises spreadsheet formulas in exported text', async () => {
    await prisma.parkingBlock.update({
      where: { code: 'BLOCK-2W' },
      data: { name: '=HYPERLINK("http://x")' },
    });
    await seedLifecycle();
    const text = (await admin.get('/reports/history')).text;
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(text).not.toMatch(/,=HYPERLINK/);
  });
});

describe('analytics', () => {
  it('summarises the day from sessions and finalized receipts', async () => {
    await seedLifecycle();
    const result = await analyticsService.forDate(undefined, 14);
    expect(result.date).toBe(today());
    expect(result.sessions).toEqual({ entered: 3, completed: 2, averageDurationHours: 3 });
    expect(result.revenue).toEqual({
      totalPaise: 10_000,
      transactions: 2,
      byVehicleType: { TWO_WHEELER: 2_000, FOUR_WHEELER: 8_000 },
      byOwnerCategory: { STAFF: 0, STUDENT: 2_000, VISITOR: 8_000 },
    });
    // 2W: 09–13 completed + parked from 11 (still active at 14:00); 4W: 10–12.
    const at = (hour: number) => result.occupancyByHour[hour]!;
    expect(at(9)).toEqual({ hour: 9, TWO_WHEELER: 1, FOUR_WHEELER: 0 });
    expect(at(11)).toEqual({ hour: 11, TWO_WHEELER: 2, FOUR_WHEELER: 1 });
    expect(at(13)).toEqual({ hour: 13, TWO_WHEELER: 1, FOUR_WHEELER: 0 });
    expect(at(15)).toEqual({ hour: 15, TWO_WHEELER: 0, FOUR_WHEELER: 0 });
    expect(result.entriesByHour.filter((row) => row.count > 0)).toEqual([
      { hour: 9, count: 1 },
      { hour: 10, count: 1 },
      { hour: 11, count: 1 },
    ]);
    expect(result.peakEntryHour).toBe(9);
    const twoWheeler = result.zones.find((zone) => zone.vehicleType === 'TWO_WHEELER')!;
    expect(twoWheeler).toMatchObject({
      sessions: 2,
      peakOccupied: 2,
      peakOccupancyPercent: 20,
      currentOccupied: 1,
    });
    expect(result.topSlots.map((slot) => slot.slotCode)).toEqual(['F-01', 'T-01', 'T-02']);
  });

  it('is empty for a day without activity and validates the date', async () => {
    await seedLifecycle();
    const res = await admin.get('/analytics', { date: addCampusDays(today(), -1) });
    expect((res.body as AnalyticsResponse).sessions.entered).toBe(0);
    expect((res.body as AnalyticsResponse).peakEntryHour).toBeNull();
    expect(errorCode(await admin.get('/analytics', { date: 'yesterday' }))).toBe(
      'VALIDATION_ERROR',
    );
  });
});

describe('alerts', () => {
  it('raises rule-based alerts for full, nearly full, long-duration and blocked', async () => {
    for (let i = 1; i <= 5; i += 1)
      await staff.checkInOk(`MH12CD000${i}`, 'FOUR_WHEELER', 'VISITOR', 12);
    for (let i = 1; i <= 8; i += 1)
      await staff.checkInOk(`KA01AB000${i}`, 'TWO_WHEELER', 'STUDENT', 5);
    await admin.post('/slots/T-10/block', { reason: 'Maintenance' }); // 8 of 9 usable → 88.9 %
    let alerts = (await alertsService.list(14)).alerts;
    expect(alerts[0]).toMatchObject({
      kind: 'ZONE_FULL',
      severity: 'critical',
      zone: { code: 'ZONE-4W', occupied: 5, usable: 5 },
    });
    expect(alerts.some((alert) => alert.kind === 'ZONE_NEARLY_FULL')).toBe(false);

    await staff.checkInOk('KA01AB0099', 'TWO_WHEELER', 'STUDENT', 13); // 9 of 9 → full
    alerts = (await alertsService.list(14)).alerts;
    expect(alerts.filter((alert) => alert.kind === 'ZONE_FULL')).toHaveLength(2);

    await staff.checkOutOk((await staff.track('KA01AB0099')).body.session.sessionNumber, 14);
    await admin.post('/slots/T-10/unblock');
    alerts = (await alertsService.list(14)).alerts; // 8 of 10 → 80 %
    expect(
      alerts.some(
        (alert) =>
          alert.kind.startsWith('ZONE') && 'zone' in alert && alert.zone.code === 'ZONE-2W',
      ),
    ).toBe(false);
    await staff.checkInOk('KA01AB0098', 'TWO_WHEELER', 'STUDENT', 13); // 9 of 10 → 90 %
    alerts = (await alertsService.list(14)).alerts;
    expect(alerts).toContainEqual(
      expect.objectContaining({
        kind: 'ZONE_NEARLY_FULL',
        severity: 'warning',
        zone: expect.objectContaining({ availableSlots: ['T-09'] }),
      }),
    );

    const long = alerts.filter((alert) => alert.kind === 'LONG_DURATION');
    expect(long).toHaveLength(8); // entered at 05:00, 9 hours by 14:00 (threshold 8)
    expect(long[0]).toMatchObject({ severity: 'warning', session: { durationHours: 9 } });
  });

  it('lists blocked slots for both roles over HTTP', async () => {
    await admin.post('/slots/T-03/block', { reason: 'Flooded' });
    const res = await request(app)
      .get('/api/v1/parking/alerts')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
    expect(res.body.thresholds).toEqual({ nearlyFullPercent: 90, longDurationHours: 8 });
    expect(res.body.alerts).toContainEqual({
      kind: 'SLOT_BLOCKED',
      severity: 'info',
      slot: { code: 'T-03', zoneName: 'Two-Wheeler Zone', reason: 'Flooded' },
    });
  });
});

describe('integrity engine', () => {
  it('reports a healthy system after normal operations', async () => {
    await seedLifecycle();
    const report = (await admin.get('/integrity')).body as IntegrityReport;
    expect(report.healthy).toBe(true);
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report.checks).toHaveLength(8);
  });

  it('detects inconsistent records', async () => {
    const { c, receiptA, receiptB } = await seedLifecycle();
    await prisma.parkingSlot.update({ where: { code: 'T-09' }, data: { status: 'OCCUPIED' } });
    await prisma.parkingSlot.update({
      where: { code: c.session.slotCode },
      data: { status: 'AVAILABLE' },
    });
    await prisma.parkingSlot.update({
      where: { code: 'F-05' },
      data: { status: 'HELD', holdToken: 'stale', holdExpiresAt: new Date(Date.now() - 1000) },
    });
    await prisma.receipt.update({
      where: { receiptNumber: receiptA.receiptNumber },
      data: { amountPaise: 1 },
    });
    await prisma.receipt.delete({ where: { receiptNumber: receiptB.receiptNumber } });

    const report = (await admin.get('/integrity')).body as IntegrityReport;
    const findings = Object.fromEntries(report.checks.map((check) => [check.code, check.findings]));
    expect(report.healthy).toBe(false);
    expect(findings.OCCUPIED_SLOT_HAS_ACTIVE_SESSION).toEqual(['T-09']);
    expect(findings.ACTIVE_SESSION_SLOT_OCCUPIED).toEqual([
      `${c.session.sessionNumber} (${c.session.slotCode}: AVAILABLE)`,
    ]);
    expect(findings.NO_EXPIRED_SLOT_HOLDS).toEqual(['F-05']);
    expect(findings.RECEIPT_MATCHES_TRANSACTION).toEqual([receiptA.receiptNumber]);
    expect(findings.COMPLETED_SESSION_HAS_RECEIPT).toEqual([receiptB.sessionNumber]);
    expect(findings.PAID_PAYMENT_HAS_RECEIPT).toEqual([receiptB.payment.transactionId]);
    expect(findings.ONE_ACTIVE_SESSION_PER_VEHICLE).toEqual([]);
  });

  it('flags stuck payments and lists recent rejections', async () => {
    const parked = await staff.checkInOk('KA01AB0001', 'TWO_WHEELER', 'VISITOR', 9);
    await staff.checkIn({
      vehicleNumber: 'KA01AB0001',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 9,
    });
    const created = await staff.createPayment({
      sessionNumber: parked.session.sessionNumber,
      exitHour: 10,
      method: 'UPI',
    });
    await prisma.$executeRaw`UPDATE payments SET status = 'PROCESSING', updated_at = now() - interval '10 minutes' WHERE id = ${created.body.payment.id}::uuid`;

    const report = (await admin.get('/integrity')).body as IntegrityReport;
    expect(report.checks.find((check) => check.code === 'NO_STUCK_PAYMENTS')!.findings).toEqual([
      created.body.payment.transactionId,
    ]);
    expect(report.recentRejections[0]).toMatchObject({
      code: 'DUPLICATE_ACTIVE_VEHICLE',
      actor: 'guard',
    });
  });
});

describe('session timeline', () => {
  it('replays the lifecycle of a session in order', async () => {
    const { a, receiptA } = await seedLifecycle();
    const res = await staff.session(`${a.session.sessionNumber}/timeline`);
    expect(res.status).toBe(200);
    const timeline = res.body as SessionTimelineResponse;
    expect(timeline.events.map((event) => event.action)).toEqual([
      'VEHICLE_CHECKED_IN',
      'SLOT_ASSIGNED',
      'CHECKOUT_INITIATED',
      'PAYMENT_INITIATED',
      'PAYMENT_SUCCEEDED',
      'TRANSACTION_FINALIZED',
      'RECEIPT_GENERATED',
      'SLOT_RELEASED',
    ]);
    const byAction = Object.fromEntries(timeline.events.map((event) => [event.action, event]));
    expect(byAction.VEHICLE_CHECKED_IN!.details).toEqual({
      vehicleNumber: 'KA22AB1234',
      entryHour: 9,
    });
    expect(byAction.SLOT_ASSIGNED!.details).toMatchObject({ slotCode: 'T-01' });
    expect(byAction.TRANSACTION_FINALIZED!.details).toMatchObject({
      exitHour: 13,
      durationHours: 4,
      amountPaise: 2000,
    });
    expect(byAction.RECEIPT_GENERATED!.details).toEqual({
      receiptNumber: receiptA.receiptNumber,
      amountPaise: 2000,
    });
    expect(byAction.SLOT_RELEASED!.actor).toEqual({
      fullName: 'SECURITY_STAFF user',
      role: 'SECURITY_STAFF',
    });
  });

  it('includes refused operations on the session and 404s for unknown sessions', async () => {
    const parked = await staff.checkInOk('KA01AB0001');
    await staff.quote({
      sessionNumber: parked.session.sessionNumber,
      exitHour: 13,
      slotCode: 'T-09',
    });
    const timeline = (await staff.session(`${parked.session.sessionNumber}/timeline`))
      .body as SessionTimelineResponse;
    expect(timeline.events.at(-1)).toMatchObject({
      action: 'INTEGRITY_REJECTED',
      details: { reason: 'SESSION_SLOT_MISMATCH' },
    });
    expect((await staff.session('CPVTS-P-00000000/timeline')).status).toBe(404);
  });
});

describe('audit log viewer', () => {
  it('filters by action, actor and entity, newest first', async () => {
    const parked: CheckInResponse = await staff.checkInOk('KA01AB0001');
    await admin.post('/slots/T-05/block', { reason: 'Maintenance' });

    const all = (await admin.get('/audit-logs')).body as Page<AuditLogEntry>;
    expect(all.items[0]).toMatchObject({
      action: 'SLOT_BLOCKED',
      actor: { username: 'boss', role: 'ADMIN' },
    });

    const byActor = (await admin.get('/audit-logs', { actor: 'GUARD' }))
      .body as Page<AuditLogEntry>;
    expect(byActor.items.map((e) => e.action).sort()).toEqual([
      'SLOT_ASSIGNED',
      'VEHICLE_CHECKED_IN',
    ]);

    const byEntity = (
      await admin.get('/audit-logs', { entityId: parked.session.sessionNumber.toLowerCase() })
    ).body as Page<AuditLogEntry>;
    expect(byEntity.items.map((e) => e.action)).toEqual(['VEHICLE_CHECKED_IN']);

    const byAction = (await admin.get('/audit-logs', { action: 'SLOT_BLOCKED', pageSize: 1 }))
      .body as Page<AuditLogEntry>;
    expect(byAction).toMatchObject({ total: 1, pageSize: 1 });
    expect(byAction.items[0]!.metadata).toEqual({ reason: 'Maintenance' });
    expect(errorCode(await admin.get('/audit-logs', { action: 'DROP_TABLE' }))).toBe(
      'VALIDATION_ERROR',
    );
  });
});
