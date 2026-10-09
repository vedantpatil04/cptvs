import {
  entryQrPayload,
  type ActiveSessionsResponse,
  type ApiErrorBody,
  type CheckoutQuote,
  type ParkingSessionView,
  type PortalLayoutResponse,
  type SessionTimelineResponse,
  type VisitorAccessResponse,
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

  it('previews the amount due (visitor rate 4W 09→13 = ₹160) but cannot pay or complete the session', async () => {
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
    // A preview leaves no trace: it is not the start of a checkout.
    expect(await prisma.auditLog.count({ where: { action: 'CHECKOUT_INITIATED' } })).toBe(0);

    // There is no visitor payment or finalization: the exit gate completes the session.
    const payment = '00000000-0000-4000-8000-000000000000';
    for (const [method, path] of [
      ['post', '/visitor/checkout/payments'],
      ['post', `/visitor/checkout/payments/${payment}/process`],
      ['post', `/visitor/checkout/payments/${payment}/cancel`],
    ] as const) {
      const res = await visitor[method](path, { method: 'UPI' });
      expect(res.status, path).toBe(403);
      expect(errorCode(res), path).toBe('GATE_CHECKOUT_REQUIRED');
    }
    expect(await slotStatus(entry.session.slotCode)).toBe('OCCUPIED');
    expect(await prisma.payment.count()).toBe(0);
    expect(
      (
        await prisma.parkingSession.findUniqueOrThrow({
          where: { sessionNumber: entry.session.sessionNumber },
        })
      ).status,
    ).toBe('ACTIVE');
  });

  it('says "ready to leave" without releasing the slot, and can take it back', async () => {
    const { visitor, entry } = await visitorSession();

    const ready = await visitor.post('/visitor/exit-request');
    expect(ready.status).toBe(200);
    expect((ready.body as { exitRequestedAt: string | null }).exitRequestedAt).not.toBeNull();
    expect(((await visitor.get('/visitor/session')).body as ParkingSessionView).lifecycle).toBe(
      'EXIT_REQUESTED',
    );
    expect(await slotStatus(entry.session.slotCode)).toBe('OCCUPIED');

    const waiting = (await guard.active({ exitRequested: true })).body as ActiveSessionsResponse;
    expect(waiting.sessions.map((s) => s.sessionNumber)).toEqual([entry.session.sessionNumber]);

    const cleared = await visitor.delete('/visitor/exit-request');
    expect((cleared.body as { exitRequestedAt: string | null }).exitRequestedAt).toBeNull();
    expect(((await visitor.get('/visitor/session')).body as ParkingSessionView).lifecycle).toBe(
      'ACTIVE',
    );
  });

  it('is completed at the gate by Security Staff, after which the visitor opens the receipt', async () => {
    const { visitor, entry } = await visitorSession();
    await visitor.post('/visitor/exit-request');

    // The guard scans the session QR on the slip and completes the checkout: 4 h × ₹40 = ₹160.
    const scanned = await guard.scan(entryQrPayload(entry.session.entryReference!));
    expect(scanned.body).toMatchObject({ exitRequested: true });
    const { receipt } = await guard.checkOutOk(entry.session.sessionNumber, 13, 'UPI');
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
      checkedOutVia: 'SECURITY',
      feeAmountPaise: 16000,
    });
    expect(stored.checkedOutById).not.toBeNull(); // the Security Staff member who took the payment

    // The audit trail records the guard, and the visitor's own timeline names nobody.
    const finalized = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'TRANSACTION_FINALIZED' },
    });
    expect(finalized.actorId).toBe(stored.checkedOutById);
    const timeline = (await visitor.get('/visitor/timeline')).body as SessionTimelineResponse;
    expect(timeline.events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['EXIT_REQUESTED', 'TRANSACTION_FINALIZED']),
    );
    expect(timeline.events.every((e) => e.actor === null)).toBe(true);

    // The visitor can no longer prepare to leave, but the slip still opens the receipt.
    expect(errorCode(await visitor.post('/visitor/exit-request'))).toBe('SESSION_NOT_ACTIVE');
    const again = await access('MH12CD5678', entry.session.sessionNumber);
    expect((again.body as VisitorAccessResponse).session).toMatchObject({
      status: 'COMPLETED',
      lifecycle: 'COMPLETED',
      receiptNumber: receipt!.receiptNumber,
    });
  });

  it("cannot prepare or preview another visitor's session", async () => {
    const first = await visitorSession('MH12CD5678');
    const second = await visitorSession('MH12ZZ0001', 'TWO_WHEELER');

    await first.visitor.post('/visitor/exit-request');
    // Each token reaches its own session only: the other's flag is untouched.
    expect(
      ((await second.visitor.get('/visitor/session')).body as ParkingSessionView).lifecycle,
    ).toBe('ACTIVE');
    expect(
      (
        await prisma.parkingSession.findUniqueOrThrow({
          where: { sessionNumber: second.entry.session.sessionNumber },
        })
      ).exitRequestedAt,
    ).toBeNull();
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
