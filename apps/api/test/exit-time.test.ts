import {
  entryQrPayload,
  type AdjustSessionTimeResponse,
  type ApiErrorBody,
  type CheckInResponse,
  type CheckoutQuote,
  type CreatePaymentResponse,
  type ParkingSessionView,
  type ParkNowConfirmation,
  type ParkNowOffer,
  type ProcessPaymentResponse,
  type ScanCheckoutResponse,
} from '@cpvts/shared';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { campusInstant } from '../src/lib/campus-time.js';
import { tokenService } from '../src/modules/auth/token.service.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn, slotStatus } from './parking-helpers.js';
import { client, createParkingUserWithVehicle } from './user-helpers.js';

/**
 * The exit time belongs to the server. Security's exit scan captures it and stops the timer;
 * Security can correct the entry/exit time (audited) and the fee is always priced afresh from the
 * recorded times. The clock is pinned (only `Date`) to a campus day so "12:20" means the same
 * wherever the suite runs.
 */

const app = createApp(config);
const DAY = '2026-11-02';

const at = (hhmm: string, day = DAY): Date => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return campusInstant(day, h * 60 + m);
};

let guardUser: { id: string; tokenVersion: number };
let adminUser: { id: string; tokenVersion: number };

/** Moves the clock and returns a Security client whose token is fresh at that time. */
const guardAt = (hhmm: string, day = DAY) => {
  vi.setSystemTime(at(hhmm, day));
  return parkingApi(app, tokenService.issueAccessToken(guardUser.id, guardUser.tokenVersion).token);
};
const adminAt = (hhmm: string) => {
  vi.setSystemTime(at(hhmm));
  return parkingApi(app, tokenService.issueAccessToken(adminUser.id, adminUser.tokenVersion).token);
};

const errorCode = (res: { body: unknown }) => (res.body as ApiErrorBody).error.code;

const adjust = (
  api: ReturnType<typeof parkingApi>,
  number: string,
  body: Record<string, unknown>,
) => api.adjustTime(number, body);

const correction = (entry: string, exit: string, extra: Record<string, unknown> = {}) => ({
  entryAt: at(entry).toISOString(),
  exitAt: at(exit).toISOString(),
  reason: 'Guard forgot to scan the exit',
  confirm: true,
  ...extra,
});

let entry: CheckInResponse;
let qr: string;
let sessionNumber: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at('09:00'));
  await resetDatabase();
  await seedLayout();
  await seedFees();
  guardUser = (await signIn('SECURITY_STAFF', 'guard')).user;
  adminUser = (await signIn('ADMIN', 'boss')).user;
  // Student two-wheeler parked at 09:00 (the official example: 2 free hours, then ₹10/hour).
  entry = await guardAt('09:00').checkInOk('KA22AB1234', 'TWO_WHEELER', 'STUDENT', 9);
  sessionNumber = entry.session.sessionNumber;
  qr = entryQrPayload(entry.session.entryReference!);
});

afterEach(() => vi.useRealTimers());
afterAll(disconnectDatabase);

const stored = () => prisma.parkingSession.findUniqueOrThrow({ where: { sessionNumber } });
const auditCount = (action: string) =>
  prisma.auditLog.count({ where: { action, entityId: sessionNumber } });

describe('the exit scan stops the timer', () => {
  it('captures the exit instant once and a repeated scan never moves it', async () => {
    const first = await guardAt('12:20').scan(qr);
    expect(first.status).toBe(200);
    const body = first.body as ScanCheckoutResponse;
    expect(body.exitAt).toBe(at('12:20').toISOString());
    expect(body.session.exitCapturedAt).toBe(at('12:20').toISOString());
    // The live values describe the captured instant: 09 → 12 is 3 hours (₹10), not "now".
    expect(body.session.currentDurationHours).toBe(3);
    expect(body.session.estimatedFee?.totalPaise).toBe(1_000);
    expect((await stored()).exitCapturedAt?.toISOString()).toBe(at('12:20').toISOString());
    expect(await auditCount('EXIT_TIME_CAPTURED')).toBe(1);

    // Two and a half hours later the scan returns the very same instant and the timer is still stopped.
    const later = guardAt('14:50');
    const again = (await later.scan(qr)).body as ScanCheckoutResponse;
    expect(again.exitAt).toBe(at('12:20').toISOString());
    expect(again.session.currentDurationHours).toBe(3);
    const view = (await later.session(sessionNumber)).body as ParkingSessionView;
    expect(view.exitCapturedAt).toBe(at('12:20').toISOString());
    expect(view.currentDurationHours).toBe(3);
    expect(view.estimatedFee?.totalPaise).toBe(1_000);
    expect(await auditCount('EXIT_TIME_CAPTURED')).toBe(1);
  });

  it('records one instant when two scans arrive at the same moment', async () => {
    const api = guardAt('12:20');
    const [a, b] = await Promise.all([api.scan(qr), api.scan(qr)]);
    expect((a.body as ScanCheckoutResponse).exitAt).toBe(at('12:20').toISOString());
    expect((b.body as ScanCheckoutResponse).exitAt).toBe(at('12:20').toISOString());
    expect(await auditCount('EXIT_TIME_CAPTURED')).toBe(1);
  });

  it('does not stop the timer when the session is only viewed, or the owner previews the fee', async () => {
    const api = guardAt('12:20');
    await api.session(sessionNumber);
    await api.track('KA22AB1234');
    await api.active();
    expect((await stored()).exitCapturedAt).toBeNull();

    // An owner opening their own screen or previewing the amount never captures anything.
    const { token, vehicle } = await createParkingUserWithVehicle(app, {
      vehicleNumber: 'KA05CD5678',
    });
    const portal = client(app, token);
    const offer = (await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }))
      .body as ParkNowOffer;
    const parked = (await portal.post('/portal/park-now/confirm', { offerId: offer.offerId }))
      .body as ParkNowConfirmation;
    const preview = await portal.post('/portal/checkout/quote', {
      sessionNumber: parked.session.sessionNumber,
    });
    expect(preview.status).toBe(200);
    const row = await prisma.parkingSession.findUniqueOrThrow({
      where: { sessionNumber: parked.session.sessionNumber },
    });
    expect(row.exitCapturedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'EXIT_TIME_CAPTURED' } })).toBe(0);
  });

  it('prices the quote from the captured instant, whenever it is requested', async () => {
    await guardAt('12:20').scan(qr);
    const late = guardAt('16:00');
    const res = await late.quote({ sessionNumber });
    expect(res.status).toBe(200);
    const quote = res.body as CheckoutQuote;
    expect(quote).toMatchObject({
      exitAt: at('12:20').toISOString(),
      exitHour: 12,
      durationHours: 3,
      timeAdjusted: false,
    });
    expect(quote.fee.totalPaise).toBe(1_000);
  });

  it('captures the exit instant at checkout when the gate reaches it without a scan', async () => {
    const res = await guardAt('13:05').quote({ sessionNumber });
    expect((res.body as CheckoutQuote).exitAt).toBe(at('13:05').toISOString());
    expect((await stored()).exitCapturedAt?.toISOString()).toBe(at('13:05').toISOString());
    expect(await auditCount('EXIT_TIME_CAPTURED')).toBe(1);
  });
});

describe('adjusting the recorded times', () => {
  it('recalculates duration and fee on the server and audits the original and corrected times', async () => {
    const api = guardAt('12:20');
    await api.scan(qr);
    const later = guardAt('14:00');

    const res = await adjust(later, sessionNumber, correction('08:50', '13:40'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { quote } = res.body as AdjustSessionTimeResponse;
    // 08:50 → 13:40 is hour 8 → hour 13: 5 whole hours, 2 free, 3 × ₹10.
    expect(quote).toMatchObject({
      exitHour: 13,
      durationHours: 5,
      timeAdjusted: true,
      exitAt: at('13:40').toISOString(),
    });
    expect(quote.session.entryAt).toBe(at('08:50').toISOString());
    expect(quote.session.entryHour).toBe(8);
    expect(quote.fee.totalPaise).toBe(3_000);

    const row = await stored();
    expect(row.entryAt.toISOString()).toBe(at('08:50').toISOString());
    expect(row.entryHour).toBe(8);
    expect(row.exitCapturedAt?.toISOString()).toBe(at('13:40').toISOString());
    expect(row.timeAdjustedAt?.toISOString()).toBe(at('14:00').toISOString());
    expect(row.status).toBe('ACTIVE');

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'SESSION_TIME_ADJUSTED', entityId: sessionNumber },
    });
    expect(log.actorId).toBe(guardUser.id);
    expect(log.metadata).toMatchObject({
      reason: 'Guard forgot to scan the exit',
      original: {
        entryAt: at('09:00').toISOString(),
        entryHour: 9,
        exitAt: at('12:20').toISOString(),
      },
      corrected: {
        entryAt: at('08:50').toISOString(),
        entryHour: 8,
        exitAt: at('13:40').toISOString(),
        exitHour: 13,
      },
      adjustedAt: at('14:00').toISOString(),
    });
  });

  it('keeps the corrected times when the session is scanned again', async () => {
    await guardAt('12:20').scan(qr);
    const api = guardAt('14:00');
    await adjust(api, sessionNumber, correction('09:10', '13:40'));
    const again = (await guardAt('15:00').scan(qr)).body as ScanCheckoutResponse;
    expect(again.exitAt).toBe(at('13:40').toISOString());
    expect(again.session.currentDurationHours).toBe(4);
    expect(again.session.timeAdjusted).toBe(true);
  });

  it('rejects an invalid range and changes nothing', async () => {
    await guardAt('12:20').scan(qr);
    const api = guardAt('14:00');
    const before = await stored();

    const cases: [Record<string, unknown>, number, string][] = [
      [correction('13:00', '12:00'), 400, 'ENTRY_AFTER_EXIT'],
      [correction('09:00', '15:30'), 400, 'EXIT_IN_FUTURE'],
      [
        {
          ...correction('09:00', '13:00'),
          entryAt: at('23:00', '2026-11-01').toISOString(),
        },
        400,
        'TIME_RANGE_OVERNIGHT',
      ],
      [
        {
          entryAt: before.entryAt.toISOString(),
          exitAt: before.exitCapturedAt!.toISOString(),
          reason: 'No change',
          confirm: true,
        },
        400,
        'TIME_UNCHANGED',
      ],
      [correction('09:00', '13:00', { reason: ' ' }), 400, 'VALIDATION_ERROR'],
      [correction('09:00', '13:00', { confirm: false }), 400, 'VALIDATION_ERROR'],
      [correction('09:00', '13:00', { exitAt: 'not-a-date' }), 400, 'VALIDATION_ERROR'],
    ];
    for (const [body, status, code] of cases) {
      const res = await adjust(api, sessionNumber, body);
      expect(res.status, JSON.stringify(res.body)).toBe(status);
      expect(errorCode(res)).toBe(code);
    }

    const after = await stored();
    expect(after.entryAt).toEqual(before.entryAt);
    expect(after.entryHour).toBe(before.entryHour);
    expect(after.exitCapturedAt).toEqual(before.exitCapturedAt);
    expect(after.timeAdjustedAt).toBeNull();
    expect(await auditCount('SESSION_TIME_ADJUSTED')).toBe(0);
  });

  it('is available to Security and administrators only', async () => {
    await guardAt('12:20').scan(qr);
    const { token } = await createParkingUserWithVehicle(app, { vehicleNumber: 'KA09EF9999' });
    const res = await client(app, token).post(
      `/parking/sessions/${sessionNumber}/adjust-time`,
      correction('09:00', '13:00'),
    );
    expect(res.status).toBe(403);
    const anonymous = await client(app).post(
      `/parking/sessions/${sessionNumber}/adjust-time`,
      correction('09:00', '13:00'),
    );
    expect(anonymous.status).toBe(401);
    expect((await stored()).timeAdjustedAt).toBeNull();

    // An administrator can correct as an override.
    const admin = adminAt('14:00');
    expect((await admin.adjustTime(sessionNumber, correction('09:00', '13:00'))).status).toBe(200);
  });

  it('cancels a payment prepared for the old times, and the new one carries the new amount', async () => {
    const api = guardAt('12:20');
    await api.scan(qr);
    const old = (await api.createPayment({ sessionNumber, method: 'UPI' }))
      .body as CreatePaymentResponse;
    expect(old.payment.amountPaise).toBe(1_000);

    const later = guardAt('14:00');
    await adjust(later, sessionNumber, correction('09:00', '13:40'));
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: old.payment.id } })).status).toBe(
      'CANCELLED',
    );
    // The superseded payment cannot be completed at the old amount.
    expect(errorCode(await later.process(old.payment.id, { sessionNumber }))).toBe(
      'PAYMENT_NOT_PENDING',
    );

    const fresh = (await later.createPayment({ sessionNumber, method: 'UPI' }))
      .body as CreatePaymentResponse;
    expect(fresh.payment.amountPaise).toBe(2_000);
    expect(fresh.quote).toMatchObject({ durationHours: 4, timeAdjusted: true });
  });

  it('refuses while a payment is being processed', async () => {
    const api = guardAt('12:20');
    await api.scan(qr);
    const created = (await api.createPayment({ sessionNumber, method: 'UPI' }))
      .body as CreatePaymentResponse;
    await prisma.payment.update({
      where: { id: created.payment.id },
      data: { status: 'PROCESSING' },
    });
    const res = await adjust(guardAt('14:00'), sessionNumber, correction('09:00', '13:40'));
    expect(errorCode(res)).toBe('PAYMENT_IN_PROGRESS');
    expect((await stored()).timeAdjustedAt).toBeNull();
  });
});

describe('finishing the checkout', () => {
  const checkout = async (api: ReturnType<typeof parkingApi>, method = 'UPI') => {
    const created = await api.createPayment({ sessionNumber, method });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { payment } = created.body as CreatePaymentResponse;
    return { payment, processed: await api.process(payment.id, { sessionNumber }) };
  };

  it('finalizes with the corrected times, once, and keeps the stay frozen afterwards', async () => {
    await guardAt('12:20').scan(qr);
    const api = guardAt('14:00');
    await adjust(api, sessionNumber, correction('09:10', '13:40'));

    const { payment, processed } = await checkout(api);
    expect(processed.status, JSON.stringify(processed.body)).toBe(200);
    const done = processed.body as ProcessPaymentResponse;
    expect(done.receipt).toMatchObject({
      totalPaise: 2_000,
      durationHours: 4,
      entryHour: 9,
      exitHour: 13,
    });

    const row = await stored();
    expect(row).toMatchObject({ status: 'COMPLETED', durationHours: 4, feeAmountPaise: 2_000 });
    expect(row.exitAt?.toISOString()).toBe(at('13:40').toISOString());
    expect(await slotStatus(entry.session.slotCode)).toBe('AVAILABLE');

    // Hours later the completed session shows the same stay: nothing ticks any more.
    const view = (await guardAt('20:00').session(sessionNumber)).body as ParkingSessionView;
    expect(view).toMatchObject({
      status: 'COMPLETED',
      durationHours: 4,
      exitCapturedAt: null,
      currentHour: null,
      currentDurationHours: null,
    });
    expect(view.exitAt).toBe(at('13:40').toISOString());

    // Repeating the payment or the scan changes nothing and releases the slot only once.
    const repeat = await guardAt('20:05').process(payment.id, { sessionNumber });
    expect(repeat.status).toBe(409);
    const rescan = await guardAt('20:06').scan(qr);
    expect(rescan.status).toBe(409);
    expect(errorCode(rescan)).toBe('SESSION_NOT_ACTIVE');
    expect(await prisma.receipt.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'SLOT_RELEASED' } })).toBe(1);
  });

  it('does not reopen or reprice a completed session', async () => {
    await guardAt('12:20').scan(qr);
    const api = guardAt('12:30');
    expect((await checkout(api)).processed.status).toBe(200);
    const before = await stored();

    const res = await adjust(guardAt('13:00'), sessionNumber, correction('09:00', '10:00'));
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SESSION_TIME_LOCKED');
    const after = await stored();
    expect(after.status).toBe('COMPLETED');
    expect(after.feeAmountPaise).toBe(before.feeAmountPaise);
    expect(after.exitAt).toEqual(before.exitAt);
    expect(await auditCount('SESSION_TIME_ADJUSTED')).toBe(0);
  });

  it('finalizes exactly once when the same payment is submitted twice at the same moment', async () => {
    const api = guardAt('12:20');
    await api.scan(qr);
    const { payment } = await (async () => {
      const created = await api.createPayment({ sessionNumber, method: 'UPI' });
      return created.body as CreatePaymentResponse;
    })();
    const [a, b] = await Promise.all([
      api.process(payment.id, { sessionNumber }),
      api.process(payment.id, { sessionNumber }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.receipt.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'SLOT_RELEASED' } })).toBe(1);
  });
});
