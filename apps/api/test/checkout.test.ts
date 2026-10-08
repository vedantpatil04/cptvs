import type {
  ApiErrorBody,
  CheckInResponse,
  CheckoutQuote,
  CreatePaymentResponse,
  DashboardSummary,
  ProcessPaymentResponse,
  ReceiptVerificationResponse,
  ReceiptView,
} from '@cpvts/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { resetDatabase } from './helpers.js';
import {
  parkingApi,
  seedFees,
  seedLayout,
  setSlotStatus,
  signIn,
  slotStatus,
} from './parking-helpers.js';

const app = createApp(config);
let api: ReturnType<typeof parkingApi>;
let admin: ReturnType<typeof parkingApi>;
let checkIn: CheckInResponse;

const errorCode = (res: { body: unknown }) => (res.body as ApiErrorBody).error.code;
const sessionNumber = () => checkIn.session.sessionNumber;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  api = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
  admin = parkingApi(app, (await signIn('ADMIN', 'boss')).token);
  checkIn = await api.checkInOk('KA22AB1234', 'TWO_WHEELER', 'STUDENT', 9);
});

afterAll(disconnectDatabase);

describe('checkout quote (fee preview)', () => {
  it('prices the official example: Student 2W 09→13 = ₹20 with a breakdown', async () => {
    const res = await api.quote({ sessionNumber: sessionNumber(), exitHour: 13 });
    const quote = res.body as CheckoutQuote;
    expect(res.status).toBe(200);
    expect(quote.durationHours).toBe(4);
    expect(quote.fee.totalPaise).toBe(2_000);
    expect(quote.fee.lines).toEqual([
      { kind: 'FREE', hours: 2 },
      { kind: 'CHARGED', hours: 2, ratePaise: 1_000, amountPaise: 2_000 },
    ]);
    expect(await prisma.auditLog.count({ where: { action: 'CHECKOUT_INITIATED' } })).toBe(1);
  });

  it('rejects an exit hour before the entry hour and invalid hours', async () => {
    const before = await api.quote({ sessionNumber: sessionNumber(), exitHour: 8 });
    expect(before.status).toBe(400);
    expect(errorCode(before)).toBe('EXIT_BEFORE_ENTRY');
    expect(errorCode(await api.quote({ sessionNumber: sessionNumber(), exitHour: 24 }))).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('accepts matching identifiers and rejects mismatched vehicle or slot', async () => {
    const ok = await api.quote({
      sessionNumber: sessionNumber(),
      exitHour: 13,
      vehicleNumber: 'ka 22 ab 1234',
      slotCode: 't-01',
    });
    expect(ok.status).toBe(200);

    const vehicle = await api.quote({
      sessionNumber: sessionNumber(),
      exitHour: 13,
      vehicleNumber: 'KA01ZZ9999',
    });
    expect(errorCode(vehicle)).toBe('VEHICLE_SESSION_MISMATCH');

    const slot = await api.quote({
      sessionNumber: sessionNumber(),
      exitHour: 13,
      slotCode: 'T-02',
    });
    expect(errorCode(slot)).toBe('SESSION_SLOT_MISMATCH');

    expect(await prisma.auditLog.count({ where: { action: 'INTEGRITY_REJECTED' } })).toBe(2);
  });

  it('reports unknown sessions', async () => {
    const res = await api.quote({ sessionNumber: 'CPVTS-P-00000000', exitHour: 13 });
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('SESSION_NOT_FOUND');
  });

  it('refuses to price when fees are not configured', async () => {
    await prisma.setting.deleteMany();
    expect(errorCode(await api.quote({ sessionNumber: sessionNumber(), exitHour: 13 }))).toBe(
      'FEE_SCHEDULE_NOT_CONFIGURED',
    );
  });
});

describe('mock payment and finalization', () => {
  it('finalizes the transaction: session COMPLETED, payment PAID, receipt issued, slot released', async () => {
    const { payment, receipt } = await api.checkOutOk(sessionNumber(), 13);

    expect(payment).toMatchObject({
      status: 'PAID',
      amountPaise: 2_000,
      isSimulated: true,
      method: 'UPI',
    });
    expect(payment.transactionId).toMatch(/^TXN-[0-9A-Z]{10}$/);
    expect(receipt).not.toBeNull();
    expect(receipt!.receiptNumber).toMatch(/^CPVTS-R-\d{4}-[0-9A-Z]{8}$/);
    expect(receipt!.receiptNumber).not.toContain(sessionNumber().slice(8));
    expect(receipt).toMatchObject({
      sessionNumber: sessionNumber(),
      vehicleNumber: 'KA22AB1234',
      slotCode: 'T-01',
      entryHour: 9,
      exitHour: 13,
      durationHours: 4,
      totalPaise: 2_000,
      payment: { status: 'PAID', transactionId: payment.transactionId, isSimulated: true },
    });

    const session = await prisma.parkingSession.findUniqueOrThrow({
      where: { sessionNumber: sessionNumber() },
    });
    expect(session).toMatchObject({
      status: 'COMPLETED',
      exitHour: 13,
      durationHours: 4,
      feeAmountPaise: 2_000,
    });
    expect(await slotStatus('T-01')).toBe('AVAILABLE');

    const actions = (
      await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' }, select: { action: true } })
    ).map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'CHECKOUT_INITIATED',
        'PAYMENT_INITIATED',
        'PAYMENT_SUCCEEDED',
        'TRANSACTION_FINALIZED',
        'RECEIPT_GENERATED',
        'SLOT_RELEASED',
      ]),
    );
  });

  it('keeps one source of truth: session, payment, receipt, history and revenue agree', async () => {
    const { receipt } = await api.checkOutOk(sessionNumber(), 13);
    const stored = await prisma.receipt.findUniqueOrThrow({
      where: { receiptNumber: receipt!.receiptNumber },
      include: { payment: true, session: true },
    });
    expect(stored.amountPaise).toBe(2_000);
    expect(stored.payment.amountPaise).toBe(stored.amountPaise);
    expect(stored.session.feeAmountPaise).toBe(stored.amountPaise);
    expect((stored.session.feeBreakdown as { totalPaise: number }).totalPaise).toBe(2_000);

    const summary = (await admin.summary()).body as DashboardSummary;
    expect(summary.todayFeesCollectedPaise).toBe(2_000);

    const view = (await api.session(sessionNumber())).body;
    expect(view).toMatchObject({
      status: 'COMPLETED',
      receiptNumber: receipt!.receiptNumber,
      fee: { totalPaise: 2_000 },
      entryReference: null,
    });
  });

  it('rejects checking out a completed session again', async () => {
    await api.checkOutOk(sessionNumber(), 13);
    const res = await api.quote({ sessionNumber: sessionNumber(), exitHour: 14 });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SESSION_NOT_ACTIVE');
    expect(
      errorCode(
        await api.createPayment({ sessionNumber: sessionNumber(), exitHour: 14, method: 'UPI' }),
      ),
    ).toBe('SESSION_NOT_ACTIVE');
    expect(await prisma.receipt.count()).toBe(1);
  });

  it('a declined simulated payment changes nothing and can be retried', async () => {
    const created = (
      await api.createPayment({ sessionNumber: sessionNumber(), exitHour: 13, method: 'CARD' })
    ).body as CreatePaymentResponse;
    const failed = await api.process(created.payment.id, {
      sessionNumber: sessionNumber(),
      outcome: 'FAILURE',
    });
    expect(failed.status).toBe(200);
    expect((failed.body as ProcessPaymentResponse).payment).toMatchObject({
      status: 'FAILED',
      failureReason: 'DECLINED_BY_TEST_PROVIDER',
    });
    expect((failed.body as ProcessPaymentResponse).receipt).toBeNull();
    expect(await slotStatus('T-01')).toBe('OCCUPIED');
    expect(
      (await prisma.parkingSession.findUniqueOrThrow({ where: { sessionNumber: sessionNumber() } }))
        .status,
    ).toBe('ACTIVE');

    const { payment } = await api.checkOutOk(sessionNumber(), 13, 'CASH');
    expect(payment.status).toBe('PAID');
  });

  it('cancels a pending payment, and a new payment supersedes an older pending one', async () => {
    const first = (
      await api.createPayment({ sessionNumber: sessionNumber(), exitHour: 13, method: 'UPI' })
    ).body as CreatePaymentResponse;
    const second = (
      await api.createPayment({ sessionNumber: sessionNumber(), exitHour: 14, method: 'UPI' })
    ).body as CreatePaymentResponse;
    expect(second.payment.amountPaise).toBe(3_000);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: first.payment.id } })).status,
    ).toBe('CANCELLED');

    const cancelled = await api.cancel(second.payment.id, { sessionNumber: sessionNumber() });
    expect(cancelled.body.payment.status).toBe('CANCELLED');
    expect(
      errorCode(await api.process(second.payment.id, { sessionNumber: sessionNumber() })),
    ).toBe('PAYMENT_NOT_PENDING');
  });

  it('rejects processing a payment for a different session', async () => {
    const other = await api.checkInOk('KA01AB0001', 'TWO_WHEELER', 'VISITOR', 10);
    const created = (
      await api.createPayment({ sessionNumber: sessionNumber(), exitHour: 13, method: 'UPI' })
    ).body as CreatePaymentResponse;
    const res = await api.process(created.payment.id, {
      sessionNumber: other.session.sessionNumber,
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('PAYMENT_SESSION_MISMATCH');
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: created.payment.id } })).status,
    ).toBe('PENDING');
  });

  it('processes a payment only once', async () => {
    const created = (
      await api.createPayment({ sessionNumber: sessionNumber(), exitHour: 13, method: 'UPI' })
    ).body as CreatePaymentResponse;
    const results = await Promise.all([
      api.process(created.payment.id, { sessionNumber: sessionNumber() }),
      api.process(created.payment.id, { sessionNumber: sessionNumber() }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await prisma.receipt.count()).toBe(1);
  });

  it('requires NO_CHARGE for ₹0 checkouts and a real method otherwise', async () => {
    expect(
      errorCode(
        await api.createPayment({
          sessionNumber: sessionNumber(),
          exitHour: 13,
          method: 'NO_CHARGE',
        }),
      ),
    ).toBe('INVALID_PAYMENT_METHOD');

    const staff = await api.checkInOk('KA01AB0002', 'FOUR_WHEELER', 'STAFF', 8);
    expect(
      errorCode(
        await api.createPayment({
          sessionNumber: staff.session.sessionNumber,
          exitHour: 17,
          method: 'UPI',
        }),
      ),
    ).toBe('INVALID_PAYMENT_METHOD');
    const { payment, receipt } = await api.checkOutOk(staff.session.sessionNumber, 17);
    expect(payment).toMatchObject({ method: 'NO_CHARGE', amountPaise: 0, status: 'PAID' });
    expect(receipt!.totalPaise).toBe(0);
    expect(await slotStatus('F-01')).toBe('AVAILABLE');
  });

  it('rolls back completely if the fee changed between payment and finalization', async () => {
    const created = (
      await api.createPayment({ sessionNumber: sessionNumber(), exitHour: 13, method: 'UPI' })
    ).body as CreatePaymentResponse;
    const schedule = (
      await prisma.setting.findUniqueOrThrow({ where: { key: 'parking.feeSchedule' } })
    ).value as { rules: { STUDENT: { TWO_WHEELER: { hourlyRatePaise: number } } } };
    schedule.rules.STUDENT.TWO_WHEELER.hourlyRatePaise = 1_500;
    await prisma.setting.update({
      where: { key: 'parking.feeSchedule' },
      data: { value: schedule },
    });

    const res = await api.process(created.payment.id, { sessionNumber: sessionNumber() });
    expect(errorCode(res)).toBe('PAYMENT_AMOUNT_MISMATCH');
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: created.payment.id } })).status,
    ).toBe('FAILED');
    expect(
      (await prisma.parkingSession.findUniqueOrThrow({ where: { sessionNumber: sessionNumber() } }))
        .status,
    ).toBe('ACTIVE');
    expect(await slotStatus('T-01')).toBe('OCCUPIED');
    expect(await prisma.receipt.count()).toBe(0);
  });

  it('keeps a slot that was blocked while occupied blocked after checkout', async () => {
    await setSlotStatus('T-01', 'BLOCKED');
    await api.checkOutOk(sessionNumber(), 13);
    expect(await slotStatus('T-01')).toBe('BLOCKED');
  });

  it('issues unique receipt numbers', async () => {
    const numbers = new Set<string>();
    const { receipt } = await api.checkOutOk(sessionNumber(), 13);
    numbers.add(receipt!.receiptNumber);
    for (let i = 0; i < 6; i += 1) {
      const next = await api.checkInOk(`KA01AB10${i}0`, 'TWO_WHEELER', 'VISITOR', 9);
      numbers.add((await api.checkOutOk(next.session.sessionNumber, 10)).receipt!.receiptNumber);
    }
    expect(numbers.size).toBe(7);
  });
});

describe('receipts and QR verification', () => {
  let receipt: ReceiptView;
  beforeEach(async () => {
    receipt = (await api.checkOutOk(sessionNumber(), 13)).receipt!;
  });

  it('returns the full receipt to signed-in users', async () => {
    const res = await admin.receipt(receipt.receiptNumber);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(receipt);
  });

  it('verifies a receipt publicly from its opaque reference', async () => {
    const res = await request(app).get(`/api/v1/public/receipts/${receipt.verificationReference}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body as ReceiptVerificationResponse).toEqual({
      status: 'VALID',
      receipt: {
        receiptNumber: receipt.receiptNumber,
        issuedAt: receipt.issuedAt,
        vehicleNumber: 'KA****1234', // masked: the public check is a capability link
        blockName: 'Two-Wheeler Parking Block',
        slotCode: 'T-01',
        durationHours: 4,
        amountPaise: 2_000,
        paymentStatus: 'PAID',
        isSimulated: true,
      },
    });
    // Never exposes session/QR secrets or transaction internals.
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(sessionNumber());
    expect(text).not.toContain(receipt.payment.transactionId);
  });

  it('reports a receipt whose records disagree as INVALID', async () => {
    await prisma.receipt.update({
      where: { receiptNumber: receipt.receiptNumber },
      data: { amountPaise: 1 },
    });
    const res = await request(app).get(`/api/v1/public/receipts/${receipt.verificationReference}`);
    expect((res.body as ReceiptVerificationResponse).status).toBe('INVALID');
  });

  it('rejects unknown and malformed references', async () => {
    const unknown = await request(app).get(`/api/v1/public/receipts/${'A'.repeat(43)}`);
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown)).toBe('RECEIPT_NOT_FOUND');
    expect((await request(app).get('/api/v1/public/receipts/short')).status).toBe(400);
  });
});

describe('live dashboard summary', () => {
  it('reports occupancy, today counts and revenue (admin only)', async () => {
    await api.checkInOk('KA01AB0001', 'FOUR_WHEELER', 'VISITOR', 9);
    await setSlotStatus('T-10', 'BLOCKED');
    const other = await api.checkInOk('KA01AB0002', 'TWO_WHEELER', 'VISITOR', 9);
    await api.checkOutOk(other.session.sessionNumber, 11); // ₹40

    const forAdmin = (await admin.summary()).body as DashboardSummary;
    expect(forAdmin.overall).toEqual({
      total: 15,
      available: 12,
      occupied: 2,
      blocked: 1,
      held: 0,
      occupancyPercent: 14.3,
    });
    expect(forAdmin.byVehicleType).toEqual([
      expect.objectContaining({
        vehicleType: 'TWO_WHEELER',
        occupied: 1,
        blocked: 1,
        occupancyPercent: 11.1,
      }),
      expect.objectContaining({ vehicleType: 'FOUR_WHEELER', occupied: 1, occupancyPercent: 20 }),
    ]);
    expect(forAdmin.currentlyParked).toBe(2);
    expect(forAdmin.todayVehicleCount).toBe(3);
    expect(forAdmin.todayFeesCollectedPaise).toBe(4_000);

    const forStaff = (await api.summary()).body as DashboardSummary;
    expect(forStaff.todayFeesCollectedPaise).toBeNull();
    expect(forStaff.currentlyParked).toBe(2);
  });
});
