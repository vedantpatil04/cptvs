import type {
  CashSummaryResponse,
  CreatePaymentResponse,
  IntegrityReport,
  NotificationsResponse,
  ShiftTransactionView,
  ShiftView,
} from '@cpvts/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn, startShift } from './parking-helpers.js';
import {
  client,
  createParkingUser,
  createParkingUserWithVehicle,
  errorCode,
} from './user-helpers.js';

/**
 * Cash accountability: every payment taken at the gate belongs to the guard's shift; at the end
 * the administrator (the cash custodian) counts what is handed over and the system compares it
 * with what it expects. Payments are simulated — nothing here is bank settlement.
 */

const app = createApp(config);
let admin: ReturnType<typeof client>;
let adminId: string;
let guard: ReturnType<typeof parkingApi>;
let guardClient: ReturnType<typeof client>;
let guardId: string;
let shiftId: string;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  const boss = await signIn('ADMIN', 'boss');
  admin = client(app, boss.token);
  adminId = boss.user.id;
  const staff = await signIn('SECURITY_STAFF', 'guard');
  guard = parkingApi(app, staff.token);
  guardClient = client(app, staff.token);
  guardId = staff.user.id;
  shiftId = staff.shift!.id;
});

afterAll(disconnectDatabase);

/** One finished visitor stay at the gate, paid with `method` (visitor rate: 2W ₹20/h, 4W ₹40/h). */
const stay = async (
  plate: string,
  hours: number,
  method: 'CASH' | 'UPI' | 'CARD',
  type: 'TWO_WHEELER' | 'FOUR_WHEELER' = 'TWO_WHEELER',
  api = guard,
) => {
  const entry = await api.checkInOk(plate, type, 'VISITOR', 9);
  return api.checkOutOk(entry.session.sessionNumber, 9 + hours, method);
};

/**
 * The reference shift: 3 cash stays (₹100 + ₹120 + ₹40 = ₹260), one UPI (₹80), one card (₹80)
 * and one no-charge student stay.
 */
const workAShift = async () => {
  await stay('KA10AA0001', 5, 'CASH'); // ₹100
  await stay('MH10AA0002', 3, 'CASH', 'FOUR_WHEELER'); // ₹120
  await stay('KA10AA0003', 2, 'CASH'); // ₹40
  await stay('KA10AA0004', 4, 'UPI'); // ₹80
  await stay('MH10AA0005', 2, 'CARD', 'FOUR_WHEELER'); // ₹80
  const student = await createParkingUserWithVehicle(app, { vehicleNumber: 'KA10AA0006' });
  const entry = await guard.checkInOk(student.vehicle.vehicleNumber, 'TWO_WHEELER', 'STUDENT', 9);
  await guard.checkOutOk(entry.session.sessionNumber, 11); // two free hours: ₹0
};

const view = async (id = shiftId) => (await admin.get(`/admin/shifts/${id}`)).body as ShiftView;

const guardChecksOut = async () => {
  const res = await guardClient.post('/security/shift/check-out');
  expect(res.status).toBe(200);
  return res.body as ShiftView;
};

describe('what a shift collected', () => {
  it('adds up cash and digital payments separately, per shift', async () => {
    await workAShift();
    const shift = await view();
    expect(shift.cash).toEqual({
      transactions: 6,
      cashTransactions: 3,
      expectedCashPaise: 26000,
      digitalTransactions: 2,
      upiPaise: 8000,
      cardPaise: 8000,
      digitalPaise: 16000,
      noChargeTransactions: 1,
      totalPaise: 42000, // cash 260 + digital 160
      openPayments: 0,
    });

    // Another guard's shift keeps its own figures.
    const other = await signIn('SECURITY_STAFF', 'guard2');
    await stay('KA10AA0007', 1, 'CASH', 'TWO_WHEELER', parkingApi(app, other.token));
    expect((await view(other.shift!.id)).cash).toMatchObject({
      cashTransactions: 1,
      expectedCashPaise: 2000,
      digitalPaise: 0,
    });
    expect((await view()).cash.expectedCashPaise).toBe(26000);
  });

  it('lists the shift’s payments, each with its receipt', async () => {
    await workAShift();
    const rows = (await admin.get(`/admin/shifts/${shiftId}/transactions`))
      .body as ShiftTransactionView[];
    expect(rows.map((r) => [r.method, r.amountPaise])).toEqual([
      ['CASH', 10000],
      ['CASH', 12000],
      ['CASH', 4000],
      ['UPI', 8000],
      ['CARD', 8000],
      ['NO_CHARGE', 0],
    ]);
    expect(rows.every((r) => r.receiptNumber?.startsWith('CPVTS-R-'))).toBe(true);
    expect(rows[0]).toMatchObject({ vehicleNumber: 'KA10AA0001' });
  });

  it('records who took each payment, in which shift, at which gate', async () => {
    await workAShift();
    const payments = await prisma.payment.findMany({
      where: { status: 'PAID' },
      include: { shift: true },
    });
    expect(payments).toHaveLength(6);
    for (const payment of payments) {
      expect(payment).toMatchObject({ processedById: guardId, shiftId });
      expect(payment.shift?.gate).toBe('Main Gate');
    }
  });

  it('counts only finished payments as collected and reports the open ones', async () => {
    const entry = await guard.checkInOk('KA10AA0001', 'TWO_WHEELER', 'VISITOR', 9);
    await guard.createPayment({
      sessionNumber: entry.session.sessionNumber,
      exitHour: 14,
      method: 'CASH',
    });
    expect((await view()).cash).toMatchObject({
      transactions: 0,
      expectedCashPaise: 0,
      openPayments: 1,
    });
  });

  it('never changes a receipt: its amount is the one the fee engine produced', async () => {
    await workAShift();
    const receipts = await prisma.receipt.findMany({ include: { payment: true, session: true } });
    for (const receipt of receipts) {
      expect(receipt.amountPaise).toBe(receipt.payment.amountPaise);
      expect(receipt.amountPaise).toBe(receipt.session.feeAmountPaise);
    }
    await guardChecksOut();
    await admin.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 26000 });
    expect(
      await prisma.receipt.findMany({
        select: { amountPaise: true },
        orderBy: { amountPaise: 'asc' },
      }),
    ).toEqual(
      receipts
        .map((r) => ({ amountPaise: r.amountPaise }))
        .sort((a, b) => a.amountPaise - b.amountPaise),
    );
  });
});

describe('handing over the cash', () => {
  it('closes the shift when the cash matches, and records who received it', async () => {
    await workAShift();
    const out = await guardChecksOut();
    expect(out).toMatchObject({ status: 'CHECKED_OUT', cashStatus: 'AWAITING_HANDOVER' });

    // The cash custodian is told there is cash to collect.
    const notices = (await admin.get('/notifications')).body as NotificationsResponse;
    const due = notices.items.find((n) => n.kind === 'SHIFT_CASH_DUE');
    expect(due?.params).toMatchObject({ amountPaise: 26000, shiftName: 'Test shift' });

    // The expected figure comes from the payments: what the request says about it is ignored.
    const res = await admin.post(`/admin/shifts/${shiftId}/handover`, {
      actualCashPaise: 26000,
      expectedCashPaise: 1,
    });
    expect(res.status).toBe(201);
    const shift = res.body as ShiftView;
    expect(shift).toMatchObject({ status: 'CLOSED', cashStatus: 'RECONCILED' });
    expect(shift.closedAt).not.toBeNull();
    expect(shift.handover).toMatchObject({
      expectedCashPaise: 26000,
      actualCashPaise: 26000,
      differencePaise: 0,
      cashTransactions: 3,
      digitalPaise: 16000,
      note: null,
      resolution: null,
    });
    expect(shift.handover?.receivedBy.id).toBe(adminId);
    expect(await prisma.auditLog.count({ where: { action: 'CASH_HANDOVER_RECORDED' } })).toBe(1);
  });

  it('records a shortfall only with a reason, and then does not call the shift closed', async () => {
    await workAShift();
    await guardChecksOut();

    const bare = await admin.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 25000 });
    expect(bare.status).toBe(400);
    expect(errorCode(bare)).toBe('CASH_NOTE_REQUIRED');
    expect(await prisma.cashHandover.count()).toBe(0);
    expect((await view()).status).toBe('CHECKED_OUT');

    const second = (await signIn('ADMIN', 'boss2')).token;
    const res = await admin.post(`/admin/shifts/${shiftId}/handover`, {
      actualCashPaise: 25000,
      note: 'Two ₹5 coins missing from the till',
    });
    expect(res.status).toBe(201);
    const shift = res.body as ShiftView;
    expect(shift).toMatchObject({
      status: 'CHECKED_OUT',
      cashStatus: 'DISCREPANCY',
      closedAt: null,
    });
    expect(shift.handover).toMatchObject({
      expectedCashPaise: 26000,
      actualCashPaise: 25000,
      differencePaise: -1000,
      note: 'Two ₹5 coins missing from the till',
      resolution: null,
    });

    // It stays in front of the administrators until reviewed — and another administrator is told.
    const open = (await admin.get('/admin/cash/discrepancies')).body as ShiftView[];
    expect(open.map((s) => s.id)).toEqual([shiftId]);
    const summary = (await admin.get('/admin/cash/summary')).body as CashSummaryResponse;
    expect(summary.openDiscrepancies.map((s) => s.id)).toEqual([shiftId]);
    expect(summary.totals).toMatchObject({
      expectedCashPaise: 26000,
      receivedCashPaise: 25000,
      digitalPaise: 16000,
      unresolvedDifferencePaise: -1000,
    });
    const alerts = (await client(app, second).get('/notifications')).body as NotificationsResponse;
    expect(alerts.items.find((n) => n.kind === 'CASH_DISCREPANCY')?.params).toMatchObject({
      differencePaise: -1000,
      amountPaise: 26000,
    });
  });

  it('treats extra cash as a difference too', async () => {
    await workAShift();
    await guardChecksOut();
    expect(
      errorCode(await admin.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 27000 })),
    ).toBe('CASH_NOTE_REQUIRED');
    const res = await admin.post(`/admin/shifts/${shiftId}/handover`, {
      actualCashPaise: 27000,
      note: 'A tip left in the till',
    });
    expect((res.body as ShiftView).handover?.differencePaise).toBe(1000);
  });

  it('closes the shift only once an administrator has reviewed the difference', async () => {
    await workAShift();
    await guardChecksOut();
    await admin.post(`/admin/shifts/${shiftId}/handover`, {
      actualCashPaise: 25000,
      note: 'Short',
    });

    expect(
      (await admin.post(`/admin/shifts/${shiftId}/handover/resolve`, { note: '  ' })).status,
    ).toBe(400);
    const resolved = await admin.post(`/admin/shifts/${shiftId}/handover/resolve`, {
      note: 'Found the missing coins in the next shift’s float',
    });
    expect(resolved.status).toBe(200);
    const shift = resolved.body as ShiftView;
    expect(shift).toMatchObject({ status: 'CLOSED', cashStatus: 'RECONCILED' });
    expect(shift.handover?.resolution).toMatchObject({
      note: 'Found the missing coins in the next shift’s float',
      resolvedBy: { id: adminId },
    });
    expect((await admin.get('/admin/cash/discrepancies')).body as ShiftView[]).toEqual([]);
    expect(
      ((await admin.get('/admin/cash/summary')).body as CashSummaryResponse).totals
        .unresolvedDifferencePaise,
    ).toBe(0);

    // A difference can be reviewed once, and a balanced handover has nothing to review.
    expect(
      errorCode(await admin.post(`/admin/shifts/${shiftId}/handover/resolve`, { note: 'again' })),
    ).toBe('DISCREPANCY_NOT_OPEN');
    expect(await prisma.auditLog.count({ where: { action: 'CASH_DISCREPANCY_RESOLVED' } })).toBe(1);
  });

  it('has nothing to review on a balanced handover or without one', async () => {
    await workAShift();
    await guardChecksOut();
    expect(
      errorCode(await admin.post(`/admin/shifts/${shiftId}/handover/resolve`, { note: 'x' })),
    ).toBe('HANDOVER_NOT_FOUND');
    await admin.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 26000 });
    expect(
      errorCode(await admin.post(`/admin/shifts/${shiftId}/handover/resolve`, { note: 'x' })),
    ).toBe('DISCREPANCY_NOT_OPEN');
    expect(
      errorCode(
        await admin.post('/admin/shifts/00000000-0000-4000-8000-000000000000/handover', {
          actualCashPaise: 0,
        }),
      ),
    ).toBe('SHIFT_NOT_FOUND');
  });

  it('can be recorded once, even if two administrators try at the same moment', async () => {
    await workAShift();
    await guardChecksOut();
    const other = client(app, (await signIn('ADMIN', 'boss2')).token);
    const results = await Promise.all([
      admin.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 26000 }),
      other.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 26000 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.map((r) => (r.status === 409 ? errorCode(r) : null)).filter(Boolean)).toEqual([
      'HANDOVER_ALREADY_RECORDED',
    ]);
    expect(await prisma.cashHandover.count()).toBe(1);
  });

  it('waits for the guard to check out and for open payments to finish', async () => {
    const entry = await guard.checkInOk('KA10AA0001', 'TWO_WHEELER', 'VISITOR', 9);
    const sessionNumber = entry.session.sessionNumber;
    const created = (await guard.createPayment({ sessionNumber, exitHour: 14, method: 'CASH' }))
      .body as CreatePaymentResponse;

    // The guard is still on duty.
    expect(
      errorCode(await admin.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 0 })),
    ).toBe('SHIFT_INVALID_STATE');

    // Checked out, but the customer has not paid yet: the payment keeps the cash open.
    await guardChecksOut();
    expect(
      errorCode(await admin.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 0 })),
    ).toBe('SHIFT_HAS_OPEN_PAYMENTS');

    // The customer pays after the guard left; the payment still belongs to the shift.
    expect((await guard.process(created.payment.id, { sessionNumber })).status).toBe(200);
    expect((await view()).cash).toMatchObject({
      cashTransactions: 1,
      expectedCashPaise: 10000,
      openPayments: 0,
    });
    const res = await admin.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 10000 });
    expect((res.body as ShiftView).status).toBe('CLOSED');
  });

  it('refuses amounts that make no sense', async () => {
    await workAShift();
    await guardChecksOut();
    for (const body of [
      { actualCashPaise: -1 },
      { actualCashPaise: 10.5 },
      { actualCashPaise: '260' },
      { actualCashPaise: 100_000_001 },
      {},
    ]) {
      expect(
        (await admin.post(`/admin/shifts/${shiftId}/handover`, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
  });

  it('is a job for administrators: nobody else counts the cash', async () => {
    await workAShift();
    await guardChecksOut();
    const student = await createParkingUser({ institutionalId: '2BT22CS777' });
    for (const caller of [guardClient, client(app, student.token)]) {
      expect(
        (await caller.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 26000 })).status,
      ).toBe(403);
      expect(
        (await caller.post(`/admin/shifts/${shiftId}/handover/resolve`, { note: 'x' })).status,
      ).toBe(403);
      expect((await caller.get('/admin/cash/summary')).status).toBe(403);
      expect((await caller.get('/admin/cash/discrepancies')).status).toBe(403);
      expect((await caller.get(`/admin/shifts/${shiftId}/transactions`)).status).toBe(403);
    }
    expect(
      (await client(app).post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 1 })).status,
    ).toBe(401);
    expect(await prisma.cashHandover.count()).toBe(0);
  });
});

describe('the cash overview', () => {
  it('shows what is collected, what is waiting, and cash that belongs to no guard’s shift', async () => {
    await workAShift();
    await guardChecksOut();
    // Cash an administrator took directly (an override) is nobody’s handover.
    const adminApi = parkingApi(app, (await signIn('ADMIN', 'boss3')).token);
    const entry = await guard
      .checkInOk('KA10AA0099', 'TWO_WHEELER', 'VISITOR', 9)
      .catch(() => null);
    expect(entry).toBeNull(); // the guard is off duty: no new entries
    const onDuty = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard9')).token);
    const parked = await onDuty.checkInOk('KA10AA0099', 'TWO_WHEELER', 'VISITOR', 9);
    await adminApi.checkOutOk(parked.session.sessionNumber, 11, 'CASH');

    const summary = (await admin.get('/admin/cash/summary')).body as CashSummaryResponse;
    expect(summary.awaitingHandover.map((s) => s.id)).toEqual([shiftId]);
    expect(summary.totals).toMatchObject({
      expectedCashPaise: 26000,
      receivedCashPaise: 0,
      digitalPaise: 16000,
    });
    expect(summary.administratorCash).toEqual({ transactions: 1, amountPaise: 4000 });
    expect(summary.unattributedCash).toEqual({ transactions: 0, amountPaise: 0 });

    await admin.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 26000 });
    const after = (await admin.get('/admin/cash/summary')).body as CashSummaryResponse;
    expect(after.awaitingHandover).toEqual([]);
    expect(after.totals.receivedCashPaise).toBe(26000);
  });

  it('can be limited to a range of dates', async () => {
    await workAShift();
    expect(
      (
        (await admin.get('/admin/cash/summary', { from: '2000-01-01', to: '2000-01-31' }))
          .body as CashSummaryResponse
      ).totals.expectedCashPaise,
    ).toBe(0);
    expect(
      (await admin.get('/admin/cash/summary', { from: '2026-02-01', to: '2026-01-01' })).status,
    ).toBe(400);
  });
});

describe('the integrity engine watches the shifts and cash', () => {
  const scan = async () => (await admin.get('/admin/integrity')).body as IntegrityReport;
  const failing = (report: IntegrityReport) =>
    report.checks.filter((check) => !check.passed).map((check) => check.code);

  it('is healthy after a normal day, including the closed shift', async () => {
    await workAShift();
    await guardChecksOut();
    await admin.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 26000 });
    const report = await scan();
    expect(failing(report)).toEqual([]);
    expect(report.healthy).toBe(true);
    expect(report.checks.map((c) => c.code)).toEqual(
      expect.arrayContaining([
        'PAID_PAYMENT_HAS_OPERATOR',
        'SHIFT_CASH_MATCHES_HANDOVER',
        'NO_OVERLAPPING_SHIFTS',
      ]),
    );
  });

  it('notices cash that changed after the handover', async () => {
    await workAShift();
    await guardChecksOut();
    await admin.post(`/admin/shifts/${shiftId}/handover`, { actualCashPaise: 26000 });
    await prisma.payment.updateMany({
      where: { method: 'CASH', shiftId },
      data: { amountPaise: 1 },
    });
    const report = await scan();
    expect(failing(report)).toContain('SHIFT_CASH_MATCHES_HANDOVER');
    expect(
      report.checks.find((c) => c.code === 'SHIFT_CASH_MATCHES_HANDOVER')?.findings[0],
    ).toContain(shiftId);
  });

  it('notices a payment nobody is recorded as having taken, and overlapping shifts', async () => {
    await workAShift();
    await prisma.payment.updateMany({ where: { method: 'UPI' }, data: { processedById: null } });
    expect(failing(await scan())).toContain('PAID_PAYMENT_HAS_OPERATOR');
    await prisma.payment.updateMany({ where: { method: 'UPI' }, data: { processedById: guardId } });

    await startShift(guardId); // a second, overlapping shift for the same guard
    const report = await scan();
    expect(failing(report)).toEqual(['NO_OVERLAPPING_SHIFTS']);
  });
});
