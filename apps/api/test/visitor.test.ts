import type {
  ApiErrorBody,
  CheckoutQuote,
  CreatePaymentResponse,
  ParkingSessionView,
  PortalLayoutResponse,
  ProcessPaymentResponse,
  SessionTimelineResponse,
  VisitorAccessResponse,
} from '@cpvts/shared';
import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn, slotStatus } from './parking-helpers.js';
import {
  adminAccount,
  client,
  createParkingUserWithVehicle,
  errorCode,
  nextInstantAtCampusHour,
} from './user-helpers.js';

const app: Express = createApp(config);
let guard: ReturnType<typeof parkingApi>;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(disconnectDatabase);

const enterVisitor = (
  vehicleNumber = 'MH12CD5678',
  type: 'TWO_WHEELER' | 'FOUR_WHEELER' = 'FOUR_WHEELER',
) => guard.checkInOk(vehicleNumber, type, 'VISITOR', 9);

const access = (vehicleNumber: string, sessionNumber: string) =>
  client(app).post('/visitor/access', { vehicleNumber, sessionNumber });

/** Opens visitor access for a fresh visitor session; returns a client bound to that one session. */
const visitorSession = async (
  vehicleNumber = 'MH12CD5678',
  type: 'TWO_WHEELER' | 'FOUR_WHEELER' = 'FOUR_WHEELER',
) => {
  const entry = await enterVisitor(vehicleNumber, type);
  const res = await access(vehicleNumber, entry.session.sessionNumber);
  const granted = res.body as VisitorAccessResponse;
  return { entry, granted, visitor: client(app, granted.accessToken) };
};

describe('visitor access', () => {
  it('grants a short-lived token for the one session on the slip', async () => {
    const entry = await enterVisitor();
    const res = await access('mh-12 cd 5678', entry.session.sessionNumber.toLowerCase());
    expect(res.status).toBe(200);
    const granted = res.body as VisitorAccessResponse;
    expect(granted.session).toMatchObject({
      sessionNumber: entry.session.sessionNumber,
      status: 'ACTIVE',
      vehicleNumber: 'MH12CD5678',
      ownerCategory: 'VISITOR',
      slotCode: 'F-01',
      block: { code: 'BLOCK-4W' },
    });
    const lifetimeMs = new Date(granted.expiresAt).getTime() - Date.now();
    expect(lifetimeMs).toBeGreaterThan(0);
    expect(lifetimeMs).toBeLessThanOrEqual(config.accounts.visitorAccessSeconds * 1000);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'VISITOR_ACCESS_GRANTED' },
    });
    expect(audit).toMatchObject({ actorId: null, entityId: entry.session.sessionNumber });
  });

  it('answers every mismatch the same way', async () => {
    const entry = await enterVisitor();
    const other = await enterVisitor('MH12ZZ0001', 'TWO_WHEELER');

    const attempts = [
      await access('MH12CD5678', 'CPVTS-P-00000000'), // unknown session
      await access('MH12ZZ9999', entry.session.sessionNumber), // wrong vehicle
      await access('MH12ZZ0001', entry.session.sessionNumber), // another visitor's vehicle
      await access('MH12CD5678', other.session.sessionNumber),
    ];
    for (const res of attempts) {
      expect(res.status).toBe(404);
      expect(errorCode(res)).toBe('VISITOR_ACCESS_DENIED');
    }
    expect(new Set(attempts.map((r) => (r.body as ApiErrorBody).error.message)).size).toBe(1);
  });

  it('is not available for a Student or Campus Staff session', async () => {
    const account = await createParkingUserWithVehicle(app);
    const entry = await guard.checkInOk(account.vehicle.vehicleNumber, 'TWO_WHEELER', 'VISITOR', 9);
    expect(entry.session.ownerCategory).toBe('STUDENT');
    const res = await access(account.vehicle.vehicleNumber, entry.session.sessionNumber);
    expect(errorCode(res)).toBe('VISITOR_ACCESS_DENIED');
  });

  it('validates the input', async () => {
    const res = await client(app).post('/visitor/access', {
      vehicleNumber: 'nope',
      sessionNumber: 'x',
    });
    expect(res.status).toBe(400);
    expect((res.body as ApiErrorBody).error.details?.map((d) => d.path).sort()).toEqual([
      'body.sessionNumber',
      'body.vehicleNumber',
    ]);
  });
});

describe('visitor token scope', () => {
  it('is rejected everywhere except the visitor routes', async () => {
    const { visitor, granted } = await visitorSession();
    for (const path of [
      '/auth/me',
      '/portal/profile',
      '/portal/overview',
      '/admin/layout',
      '/admin/users',
      '/parking/map',
      '/parking/sessions/active',
      '/dashboard/summary',
    ]) {
      expect((await visitor.get(path)).status, path).toBe(401);
    }
    expect((await visitor.post('/parking/check-ins', {})).status).toBe(401);
    expect((await visitor.post('/auth/logout')).status).toBe(401);
    expect((await visitor.get('/visitor/session')).status).toBe(200);
    expect(granted.accessToken).toBeTruthy();
  });

  it('cannot be replaced by an account token', async () => {
    await visitorSession();
    const student = await createParkingUserWithVehicle(app);
    for (const token of [
      student.token,
      (await adminAccount()).token,
      (await signIn('SECURITY_STAFF', 'guard2')).token,
    ]) {
      expect((await client(app, token).get('/visitor/session')).status).toBe(401);
    }
    expect((await client(app).get('/visitor/session')).status).toBe(401);
    expect((await client(app, 'garbage').get('/visitor/session')).status).toBe(401);
  });

  it('only ever shows its own session', async () => {
    const first = await visitorSession('MH12CD5678');
    const second = await visitorSession('MH12ZZ0001', 'TWO_WHEELER');
    const a = (await first.visitor.get('/visitor/session')).body as ParkingSessionView;
    const b = (await second.visitor.get('/visitor/session')).body as ParkingSessionView;
    expect(a.sessionNumber).toBe(first.entry.session.sessionNumber);
    expect(b.sessionNumber).toBe(second.entry.session.sessionNumber);
    expect(a.sessionNumber).not.toBe(b.sessionNumber);
  });

  it('expires', async () => {
    const entry = await enterVisitor();
    vi.useFakeTimers({ toFake: ['Date'] });
    const granted = (await access('MH12CD5678', entry.session.sessionNumber))
      .body as VisitorAccessResponse;
    vi.setSystemTime(new Date(Date.now() + (config.accounts.visitorAccessSeconds + 60) * 1000));
    const res = await client(app, granted.accessToken).get('/visitor/session');
    expect(res.status).toBe(401);
  });
});

describe('visitor parking', () => {
  it('shows the current parking, the location and a layout without other vehicles', async () => {
    const { visitor, entry } = await visitorSession();
    await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'STUDENT', 9);

    const session = (await visitor.get('/visitor/session')).body as ParkingSessionView;
    expect(session).toMatchObject({
      slotCode: entry.session.slotCode,
      block: { name: 'Four-Wheeler Parking Block' },
      entryHour: 9,
      status: 'ACTIVE',
    });
    expect(session.currentDurationHours).not.toBeNull();
    expect(session.estimatedFee).not.toBeNull();

    const layout = (await visitor.get('/visitor/layout')).body as PortalLayoutResponse;
    expect(layout.mySlots).toEqual([entry.session.slotCode]);
    expect(JSON.stringify(layout)).not.toContain('KA22AB1234');
    expect(JSON.stringify(layout)).not.toContain('MH12CD5678');
  });

  it('checks out and pays: the visitor rate 4W 09→13 = ₹160, then shows the receipt', async () => {
    const entry = await enterVisitor();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(nextInstantAtCampusHour(13));
    const visitor = client(
      app,
      ((await access('MH12CD5678', entry.session.sessionNumber)).body as VisitorAccessResponse)
        .accessToken,
    );

    expect(errorCode(await visitor.get('/visitor/receipt'))).toBe('RECEIPT_NOT_FOUND');

    const quote = (await visitor.post('/visitor/checkout/quote')).body as CheckoutQuote;
    expect(quote).toMatchObject({ exitHour: 13, durationHours: 4 });
    expect(quote.fee.totalPaise).toBe(16000);

    // The amount is due, so "no charge" is refused.
    expect(
      errorCode(await visitor.post('/visitor/checkout/payments', { method: 'NO_CHARGE' })),
    ).toBe('INVALID_PAYMENT_METHOD');

    const created = await visitor.post('/visitor/checkout/payments', { method: 'UPI' });
    expect(created.status).toBe(201);
    const { payment } = created.body as CreatePaymentResponse;
    expect(payment).toMatchObject({ amountPaise: 16000, status: 'PENDING', isSimulated: true });

    const processed = await visitor.post(`/visitor/checkout/payments/${payment.id}/process`, {});
    expect(processed.status).toBe(200);
    const { receipt } = processed.body as ProcessPaymentResponse;
    expect(receipt).toMatchObject({
      sessionNumber: entry.session.sessionNumber,
      vehicleNumber: 'MH12CD5678',
      ownerCategory: 'VISITOR',
      totalPaise: 16000,
      payment: { status: 'PAID', method: 'UPI' },
    });

    expect((await visitor.get('/visitor/receipt')).body).toMatchObject({
      receiptNumber: receipt!.receiptNumber,
    });
    expect(await slotStatus(entry.session.slotCode)).toBe('AVAILABLE');

    const stored = await prisma.parkingSession.findUniqueOrThrow({
      where: { sessionNumber: entry.session.sessionNumber },
    });
    expect(stored).toMatchObject({
      status: 'COMPLETED',
      checkedOutById: null,
      checkedOutVia: 'VISITOR',
      feeAmountPaise: 16000,
    });

    // The audit trail records the visitor channel instead of an account.
    const finalized = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'TRANSACTION_FINALIZED' },
    });
    expect(finalized).toMatchObject({ actorId: null });
    expect(finalized.metadata).toMatchObject({ via: 'VISITOR' });

    const timeline = (await visitor.get('/visitor/timeline')).body as SessionTimelineResponse;
    expect(timeline.events.map((e) => e.channel)).toContain('VISITOR');
    expect(timeline.events.every((e) => e.actor === null)).toBe(true);

    // The slip still works for the receipt after checkout.
    const again = await access('MH12CD5678', entry.session.sessionNumber);
    expect((again.body as VisitorAccessResponse).session).toMatchObject({
      status: 'COMPLETED',
      receiptNumber: receipt!.receiptNumber,
    });
  });

  it('keeps the slot occupied after a declined payment and allows a retry', async () => {
    const entry = await enterVisitor('MH12ZZ0001', 'TWO_WHEELER');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(nextInstantAtCampusHour(11));
    const visitor = client(
      app,
      ((await access('MH12ZZ0001', entry.session.sessionNumber)).body as VisitorAccessResponse)
        .accessToken,
    );

    const first = (await visitor.post('/visitor/checkout/payments', { method: 'CARD' }))
      .body as CreatePaymentResponse;
    const declined = await visitor.post(`/visitor/checkout/payments/${first.payment.id}/process`, {
      outcome: 'FAILURE',
    });
    expect((declined.body as ProcessPaymentResponse).payment.status).toBe('FAILED');
    expect(await slotStatus(entry.session.slotCode)).toBe('OCCUPIED');

    const second = (await visitor.post('/visitor/checkout/payments', { method: 'CARD' }))
      .body as CreatePaymentResponse;
    const cancelled = await visitor.post(`/visitor/checkout/payments/${second.payment.id}/cancel`);
    expect((cancelled.body as { payment: { status: string } }).payment.status).toBe('CANCELLED');

    const third = (await visitor.post('/visitor/checkout/payments', { method: 'UPI' }))
      .body as CreatePaymentResponse;
    const paid = await visitor.post(`/visitor/checkout/payments/${third.payment.id}/process`, {});
    expect((paid.body as ProcessPaymentResponse).receipt?.totalPaise).toBe(4000); // 2 h × ₹20
  });

  it("cannot touch another visitor's payment", async () => {
    const first = await enterVisitor('MH12CD5678');
    const second = await enterVisitor('MH12ZZ0001', 'TWO_WHEELER');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(nextInstantAtCampusHour(12));
    const tokenOf = async (vehicle: string, sessionNumber: string) =>
      client(
        app,
        ((await access(vehicle, sessionNumber)).body as VisitorAccessResponse).accessToken,
      );
    const a = await tokenOf('MH12CD5678', first.session.sessionNumber);
    const b = await tokenOf('MH12ZZ0001', second.session.sessionNumber);

    const { payment } = (await a.post('/visitor/checkout/payments', { method: 'UPI' }))
      .body as CreatePaymentResponse;
    expect(errorCode(await b.post(`/visitor/checkout/payments/${payment.id}/process`, {}))).toBe(
      'PAYMENT_NOT_FOUND',
    );
    expect(errorCode(await b.post(`/visitor/checkout/payments/${payment.id}/cancel`))).toBe(
      'PAYMENT_NOT_FOUND',
    );
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'PENDING',
    );
  });

  it('closes access once a completed session is older than the access window', async () => {
    const entry = await enterVisitor();
    await prisma.$executeRawUnsafe(
      `UPDATE parking_sessions SET status = 'COMPLETED', entry_at = now() - interval '30 hours',
         exit_at = now() - interval '24 hours', exit_hour = 12, duration_hours = 3, fee_amount_paise = 0,
         fee_breakdown = '{}'::jsonb, checked_out_via = 'VISITOR' WHERE session_number = $1`,
      entry.session.sessionNumber,
    );
    const res = await access('MH12CD5678', entry.session.sessionNumber);
    expect(errorCode(res)).toBe('VISITOR_ACCESS_DENIED');
  });
});
