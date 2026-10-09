import {
  entryQrPayload,
  OPAQUE_REFERENCE_PATTERN,
  type ApiErrorBody,
  type CheckoutQuote,
  type CreatePaymentResponse,
  type ParkNowConfirmation,
  type ParkNowOffer,
  type ProcessPaymentResponse,
  type ReceiptVerificationResponse,
  type ScanCheckoutResponse,
} from '@cpvts/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { newOpaqueReference } from '../src/lib/identifiers.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn, slotStatus } from './parking-helpers.js';
import {
  adminAccount,
  client,
  createParkingUser,
  createParkingUserWithVehicle,
  errorCode,
} from './user-helpers.js';

const app = createApp(config);
let guard: ReturnType<typeof parkingApi>;
let guardUserId: string;
let adminToken: string;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  const staff = await signIn('SECURITY_STAFF', 'guard');
  guard = parkingApi(app, staff.token);
  guardUserId = staff.user.id;
  adminToken = (await adminAccount()).token;
});

afterAll(disconnectDatabase);

/** Checks a vehicle in at the desk and returns the session with the printed QR text. */
const enter = async (plate: string, type: 'TWO_WHEELER' | 'FOUR_WHEELER' = 'TWO_WHEELER') => {
  const entry = await guard.checkInOk(plate, type, 'VISITOR', 9);
  return { ...entry, qr: entryQrPayload(entry.session.entryReference!) };
};

describe('the session QR at the exit gate', () => {
  it('identifies the active session and tells what the server verified', async () => {
    const parked = await enter('KA22AB1234');
    const res = await guard.scan(parked.qr);
    expect(res.status).toBe(200);
    const body = res.body as ScanCheckoutResponse;
    expect(body).toMatchObject({
      matchedBy: 'ENTRY_QR',
      exitRequested: false,
      checks: {
        reference: true,
        sessionActive: true,
        vehicleMatchesSession: true,
        slotMatchesSession: true,
      },
      session: {
        sessionNumber: parked.session.sessionNumber,
        status: 'ACTIVE',
        vehicleNumber: 'KA22AB1234',
        slotCode: parked.session.slotCode,
        block: { code: 'BLOCK-2W' },
        ownerCategory: 'VISITOR',
      },
    });
    // The authoritative details the operator continues with are in the response.
    expect(body.session.estimatedFee).not.toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'CHECKOUT_QR_SCANNED' },
    });
    expect(audit).toMatchObject({
      actorId: guardUserId,
      entityId: parked.session.sessionNumber,
    });
  });

  it('accepts the bare reference as well as the prefixed text, with stray whitespace', async () => {
    const parked = await enter('KA22AB1234');
    const reference = parked.session.entryReference!;
    for (const text of [
      reference,
      ` ${parked.qr} `,
      parked.qr.toUpperCase().replace(reference.toUpperCase(), reference),
    ]) {
      const res = await guard.scan(text);
      expect(res.status, text).toBe(200);
    }
  });

  it('carries only an opaque reference, never personal or session data', async () => {
    const parked = await enter('KA22AB1234');
    const reference = parked.session.entryReference!;
    expect(reference).toMatch(OPAQUE_REFERENCE_PATTERN);
    for (const sensitive of [
      'KA22AB1234',
      parked.session.sessionNumber,
      parked.session.slotCode,
      'VISITOR',
    ]) {
      expect(parked.qr).not.toContain(sensitive);
    }
    // The same reference is not shared by the two sessions, and is never reused for the receipt.
    const other = await enter('KA01CD5678');
    expect(other.session.entryReference).not.toBe(reference);
  });

  it.each([
    ['not a CPVTS code', 'hello world'],
    ['a code of the wrong length', 'cpvts:session:short'],
    ['a payment link', 'https://example.com/pay?x=1'],
    ['an unknown but well-formed reference', `cpvts:session:${newOpaqueReference()}`],
    ['an unknown bare reference', newOpaqueReference()],
  ])('refuses %s alike, and audits the refusal', async (_label, text) => {
    const res = await guard.scan(text);
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('INVALID_QR_REFERENCE');
    const rejected = await prisma.auditLog.count({
      where: { action: 'INTEGRITY_REJECTED', actorId: guardUserId },
    });
    expect(rejected).toBe(1);
  });

  it('rejects an empty scan as invalid input', async () => {
    const res = await guard.scan('   ');
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
  });

  it("refuses a completed session's QR: the slot may already belong to someone else", async () => {
    const parked = await enter('KA22AB1234');
    await guard.checkOutOk(parked.session.sessionNumber, 12);
    const res = await guard.scan(parked.qr);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SESSION_NOT_ACTIVE');
  });

  it('notices when the records of the session, its vehicle and its slot do not agree', async () => {
    const parked = await enter('KA22AB1234');
    await prisma.parkingSlot.update({
      where: { code: parked.session.slotCode },
      data: { status: 'AVAILABLE' },
    });
    const res = await guard.scan(parked.qr);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('SESSION_INCONSISTENT');
  });

  it('reports "ready to leave" from the owner to the operator', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const offer = (await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }))
      .body as ParkNowOffer;
    const confirmed = (await portal.post('/portal/park-now/confirm', { offerId: offer.offerId }))
      .body as ParkNowConfirmation;
    await portal.post(`/portal/sessions/${confirmed.session.sessionNumber}/exit-request`);

    const scanned = (await guard.scan(entryQrPayload(confirmed.session.entryReference!)))
      .body as ScanCheckoutResponse;
    expect(scanned.exitRequested).toBe(true);
    expect(scanned.session).toMatchObject({
      lifecycle: 'EXIT_REQUESTED',
      ownerCategory: 'STUDENT',
    });
  });
});

describe('only an authorized operator can use a QR', () => {
  it('turns away everyone who is not Security Staff or an administrator', async () => {
    const parked = await enter('KA22AB1234');
    const student = await createParkingUser();
    const body = { qr: parked.qr };

    expect((await request(app).post('/api/v1/parking/checkouts/scan').send(body)).status).toBe(401);
    expect((await client(app, student.token).post('/parking/checkouts/scan', body)).status).toBe(
      403,
    );

    // A visitor token is not an account token: it opens the visitor routes only.
    const access = await client(app).post('/visitor/access', {
      vehicleNumber: 'KA22AB1234',
      sessionNumber: parked.session.sessionNumber,
    });
    const visitorToken = (access.body as { accessToken: string }).accessToken;
    expect((await client(app, visitorToken).post('/parking/checkouts/scan', body)).status).toBe(
      401,
    );

    // Knowing the QR is not enough even for the people it is meant for: nothing is finalized.
    expect(
      (
        await client(app, student.token).post('/parking/payments', {
          sessionNumber: parked.session.sessionNumber,
          exitHour: 12,
          method: 'UPI',
        })
      ).status,
    ).toBe(403);
    expect(await slotStatus(parked.session.slotCode)).toBe('OCCUPIED');
  });

  it('lets an administrator scan', async () => {
    const parked = await enter('KA22AB1234');
    const res = await client(app, adminToken).post('/parking/checkouts/scan', { qr: parked.qr });
    expect(res.status).toBe(200);
  });
});

describe('the scanned QR must belong to the session being checked out', () => {
  it('rejects another session’s QR on the quote and the payment, and creates nothing', async () => {
    const a = await enter('KA22AB1234');
    const b = await enter('KA01CD5678');
    const sessionNumber = a.session.sessionNumber;

    const quote = await guard.quote({ sessionNumber, exitHour: 12, entryReference: b.qr });
    expect(quote.status).toBe(409);
    expect(errorCode(quote)).toBe('QR_SESSION_MISMATCH');
    const payment = await guard.createPayment({
      sessionNumber,
      exitHour: 12,
      method: 'UPI',
      entryReference: b.session.entryReference,
    });
    expect(errorCode(payment)).toBe('QR_SESSION_MISMATCH');
    expect(await prisma.payment.count()).toBe(0);

    // Garbage in the QR field is an invalid QR, not a different session’s.
    const garbage = await guard.quote({ sessionNumber, exitHour: 12, entryReference: 'nope' });
    expect(errorCode(garbage)).toBe('INVALID_QR_REFERENCE');
  });

  it('checks vehicle, slot and QR together, and finalizes with the right ones', async () => {
    const a = await enter('KA22AB1234');
    const sessionNumber = a.session.sessionNumber;
    const wrongVehicle = await guard.quote({
      sessionNumber,
      exitHour: 12,
      vehicleNumber: 'KA01CD5678',
    });
    expect(errorCode(wrongVehicle)).toBe('VEHICLE_SESSION_MISMATCH');
    const wrongSlot = await guard.quote({ sessionNumber, exitHour: 12, slotCode: 'T-09' });
    expect(errorCode(wrongSlot)).toBe('SESSION_SLOT_MISMATCH');

    const identifiers = {
      sessionNumber,
      exitHour: 12,
      vehicleNumber: 'KA22AB1234',
      slotCode: a.session.slotCode,
      entryReference: a.qr,
    };
    const quote = (await guard.quote(identifiers)).body as CheckoutQuote;
    expect(quote.fee.totalPaise).toBe(6000); // visitor 2W: 3 h × ₹20
    const created = (await guard.createPayment({ ...identifiers, method: 'UPI' }))
      .body as CreatePaymentResponse;
    const done = (await guard.process(created.payment.id, { sessionNumber }))
      .body as ProcessPaymentResponse;
    expect(done.receipt).toMatchObject({ totalPaise: 6000, sessionNumber });
    expect(await slotStatus(a.session.slotCode)).toBe('AVAILABLE');
  });

  it('keeps the receipt QR for verifying receipts only: it can neither scan nor check out', async () => {
    const done = await enter('KA22AB1234');
    const { receipt } = await guard.checkOutOk(done.session.sessionNumber, 12);
    const next = await enter('KA01CD5678');

    const receiptReference = receipt!.verificationReference;
    expect(receiptReference).not.toBe(done.session.entryReference);
    expect((await guard.scan(receiptReference)).status).toBe(400);
    expect(errorCode(await guard.scan(`https://cpvts.example/verify/${receiptReference}`))).toBe(
      'INVALID_QR_REFERENCE',
    );
    // Offered as proof for a live session, it does not match.
    const attach = await guard.quote({
      sessionNumber: next.session.sessionNumber,
      exitHour: 12,
      entryReference: receiptReference,
    });
    expect(errorCode(attach)).toBe('QR_SESSION_MISMATCH');

    // And the session QR verifies no receipt.
    const verify = await request(app).get(`/api/v1/public/receipts/${next.session.entryReference}`);
    expect(verify.status).toBe(404);
  });
});

describe('the same fee authority at the gate', () => {
  it('prices from the fee engine whatever the request says about the amount', async () => {
    const a = await enter('KA22AB1234');
    const created = await guard.createPayment({
      sessionNumber: a.session.sessionNumber,
      exitHour: 12,
      method: 'UPI',
      amountPaise: 1, // ignored: the amount is not an input
      totalPaise: 1,
    });
    expect(created.status).toBe(201);
    expect((created.body as CreatePaymentResponse).payment.amountPaise).toBe(6000);
  });
});

describe('an administrator can finalize a checkout as an override', () => {
  it('records who took the payment, with no shift, and flags the override', async () => {
    const a = await enter('KA22AB1234');
    const adminApi = parkingApi(app, adminToken);
    const done = await adminApi.checkOutOk(a.session.sessionNumber, 12, 'CASH');
    expect(done.receipt?.totalPaise).toBe(6000);

    const payment = await prisma.payment.findFirstOrThrow({ include: { processedBy: true } });
    expect(payment).toMatchObject({ status: 'PAID', shiftId: null });
    expect(payment.processedBy?.role).toBe('ADMIN');
    const session = await prisma.parkingSession.findUniqueOrThrow({
      where: { sessionNumber: a.session.sessionNumber },
    });
    expect(session).toMatchObject({
      checkedOutVia: 'SECURITY',
      checkedOutById: payment.processedById,
    });

    const finalized = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'TRANSACTION_FINALIZED' },
    });
    expect(finalized.metadata).toMatchObject({ override: true });
  });

  it('does not let an administrator enter vehicles (that is the Security desk)', async () => {
    const res = await client(app, adminToken).post('/parking/check-ins', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 9,
    });
    expect(res.status).toBe(403);
  });
});

describe('desk entry and Park Now create the same kind of session', () => {
  it('produces identical records, QR references, audit trails and owner notifications', async () => {
    const viaPortal = await createParkingUserWithVehicle(app, {
      institutionalId: '2BT22CS001',
      vehicleNumber: 'KA22AB1234',
    });
    const viaDesk = await createParkingUserWithVehicle(app, {
      institutionalId: '2BT22CS002',
      vehicleNumber: 'KA01CD5678',
    });
    const portal = client(app, viaPortal.token);
    const offer = (
      await portal.post('/portal/park-now/offers', { vehicleId: viaPortal.vehicle.id })
    ).body as ParkNowOffer;
    const confirmed = (await portal.post('/portal/park-now/confirm', { offerId: offer.offerId }))
      .body as ParkNowConfirmation;
    const desk = await guard.checkInOk(viaDesk.vehicle.vehicleNumber, 'TWO_WHEELER', 'VISITOR', 9);

    // The same session view.
    expect(Object.keys(confirmed.session).sort()).toEqual(Object.keys(desk.session).sort());
    expect(confirmed.session).toMatchObject({ status: 'ACTIVE', ownerCategory: 'STUDENT' });
    expect(desk.session).toMatchObject({ status: 'ACTIVE', ownerCategory: 'STUDENT' });
    expect(desk.categorySource).toBe('ACCOUNT');

    // The same stored record: an opaque QR reference, the owner, who entered it.
    const rows = await prisma.parkingSession.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.entryReference).toMatch(OPAQUE_REFERENCE_PATTERN);
      expect(row.sessionNumber).toMatch(/^CPVTS-P-/);
      expect(row.ownerUserId).not.toBeNull();
      expect(row.status).toBe('ACTIVE');
    }
    expect(rows[0]?.checkedInById).toBe(viaPortal.user.id); // the owner, with Park Now
    expect(rows[1]?.checkedInById).toBe(guardUserId); // the Security Staff member, at the desk

    // The same audit trail and the same owner notification.
    for (const row of rows) {
      const trail = await prisma.auditLog.findMany({
        where: {
          OR: [
            { entityId: row.sessionNumber },
            { metadata: { path: ['sessionNumber'], equals: row.sessionNumber } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(trail.map((entry) => entry.action).sort()).toEqual([
        'SLOT_ASSIGNED',
        'VEHICLE_CHECKED_IN',
      ]);
      expect(
        await prisma.notification.count({
          where: { userId: row.ownerUserId!, kind: 'PARKING_STARTED' },
        }),
      ).toBe(1);
    }

    // Both are checked out the same way: scan the QR, pay at the gate.
    for (const session of [confirmed.session, desk.session]) {
      const scanned = await guard.scan(entryQrPayload(session.entryReference!));
      expect(scanned.status).toBe(200);
      const done = await guard.checkOutOk(session.sessionNumber, session.entryHour);
      expect(done.receipt?.sessionNumber).toBe(session.sessionNumber);
    }
  });
});

describe('API errors stay in one shape', () => {
  it('returns the standard envelope for gate refusals', async () => {
    const res = await guard.scan('nope');
    const body = res.body as ApiErrorBody;
    expect(body.error).toMatchObject({ code: 'INVALID_QR_REFERENCE' });
    expect(typeof body.error.message).toBe('string');
    expect(typeof body.error.requestId).toBe('string');
  });
});

describe('receipt verification stays a separate, safe, public check', () => {
  it('shows a masked plate and no personal details', async () => {
    const done = await enter('KA22AB1234');
    const { receipt } = await guard.checkOutOk(done.session.sessionNumber, 12);
    const res = await request(app).get(`/api/v1/public/receipts/${receipt!.verificationReference}`);
    expect(res.status).toBe(200);
    const body = res.body as ReceiptVerificationResponse;
    expect(body.status).toBe('VALID');
    expect(body.receipt.vehicleNumber).toBe('KA****1234');
    const text = JSON.stringify(res.body);
    for (const secret of ['KA22AB1234', done.session.sessionNumber, done.session.entryReference!]) {
      expect(text).not.toContain(secret);
    }
  });
});
