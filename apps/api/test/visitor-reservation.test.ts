import {
  entryQrPayload,
  type ActivateArrivalResponse,
  type ArrivalResponse,
  type ParkingSessionView,
  type PendingArrivalsResponse,
  type PublicOverviewResponse,
  type ScanCheckoutResponse,
  type VisitorReservationCreated,
  type VisitorReservationStatusResponse,
} from '@cpvts/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn } from './parking-helpers.js';
import {
  client,
  createParkingUser,
  createParkingUserWithVehicle,
  errorCode,
} from './user-helpers.js';

const app = createApp(config);
let guard: ReturnType<typeof parkingApi>;
let guardToken: string;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  const staff = await signIn('SECURITY_STAFF', 'guard');
  guardToken = staff.token;
  guard = parkingApi(app, staff.token);
});

afterAll(disconnectDatabase);

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const reserve = (vehicleNumber = 'KA22AB1234', vehicleType = 'TWO_WHEELER') =>
  request(app)
    .post('/api/v1/public/visitor-reservations')
    .send({ vehicleNumber, vehicleType, contactPhone: '+91 98765 43210' });

const reserveOk = async (vehicleNumber?: string, vehicleType?: string) => {
  const res = await reserve(vehicleNumber, vehicleType);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as VisitorReservationCreated;
};

const status = (token: string) =>
  request(app).get('/api/v1/visitor/reservation').set(bearer(token));

const find = (body: Record<string, unknown>, token = guardToken) =>
  request(app).post('/api/v1/parking/arrivals/find').set(bearer(token)).send(body);

const activate = (reservationId: string, token = guardToken) =>
  request(app).post(`/api/v1/parking/arrivals/${reservationId}/activate`).set(bearer(token));

const slotState = async (code: string) => prisma.parkingSlot.findUniqueOrThrow({ where: { code } });

describe('visitor self-service reservation', () => {
  it('assigns the block and slot automatically, holds it and creates no session', async () => {
    const created = await reserveOk();
    const { reservation } = created;

    expect(reservation).toMatchObject({
      status: 'HELD',
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      block: { code: 'BLOCK-2W' },
      sessionNumber: null,
    });
    expect(reservation.slotCode).toMatch(/^T-\d\d$/);
    expect(reservation.qrReference).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reservation.holdSeconds).toBe(config.parking.visitorHoldMs / 1000);
    expect(new Date(reservation.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(created.accessToken.length).toBeGreaterThan(20);

    // The slot is held for this visitor; nobody is parked yet.
    expect((await slotState(reservation.slotCode)).status).toBe('HELD');
    expect(await prisma.parkingSession.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'VISITOR_RESERVATION_CREATED' } })).toBe(
      1,
    );
  });

  it('never gives the same slot to two visitors, even when they ask at the same moment', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => reserve(`KA01AB10${i}0`)),
    );
    for (const res of results) expect(res.status, JSON.stringify(res.body)).toBe(201);
    const slots = results.map(
      (res) => (res.body as VisitorReservationCreated).reservation.slotCode,
    );
    expect(new Set(slots).size).toBe(5);
  });

  it('keeps a held slot away from the security desk and from other visitors', async () => {
    const { reservation } = await reserveOk('KA01AB1111');
    const entry = await guard.checkInOk('KA02CD2222', 'TWO_WHEELER', 'STUDENT', 9);
    expect(entry.session.slotCode).not.toBe(reservation.slotCode);
    const other = await reserveOk('KA03EF3333');
    expect(other.reservation.slotCode).not.toBe(reservation.slotCode);
  });

  it('allows only one open reservation per vehicle', async () => {
    await reserveOk('KA22AB1234');
    const again = await reserve('KA22AB1234');
    expect(again.status).toBe(409);
  });

  it('refuses invalid input without touching any slot', async () => {
    const bad = [
      { vehicleNumber: 'nope', vehicleType: 'TWO_WHEELER', contactPhone: '9876543210' },
      { vehicleNumber: 'KA22AB1234', vehicleType: 'TRUCK', contactPhone: '9876543210' },
      { vehicleNumber: 'KA22AB1234', vehicleType: 'TWO_WHEELER', contactPhone: '12' },
      { vehicleNumber: 'KA22AB1234', vehicleType: 'TWO_WHEELER' },
    ];
    for (const body of bad) {
      const res = await request(app).post('/api/v1/public/visitor-reservations').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.visitorReservation.count()).toBe(0);
    expect(await prisma.parkingSlot.count({ where: { status: 'HELD' } })).toBe(0);
  });

  it("sends a registered account's vehicle to Park My Vehicle instead", async () => {
    const owner = await createParkingUserWithVehicle(app);
    const res = await reserve(owner.vehicle.vehicleNumber);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('VISITOR_VEHICLE_REGISTERED');
  });

  it('refuses a vehicle that is already parked, or has another type on record', async () => {
    await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 9);
    expect(errorCode(await reserve('KA22AB1234'))).toBe('DUPLICATE_ACTIVE_VEHICLE');
    const mismatch = await reserve('KA22AB1234', 'FOUR_WHEELER');
    expect(mismatch.status).toBe(409);
  });

  it('reports a full lot instead of inventing a slot', async () => {
    await prisma.parkingSlot.updateMany({
      where: { zone: { vehicleType: 'TWO_WHEELER' } },
      data: { status: 'OCCUPIED' },
    });
    const res = await reserve();
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ZONE_FULL');
  });

  it('caps how many reservations can be open at once so the lot can not be hoarded', async () => {
    for (let i = 0; i < config.parking.visitorMaxOpenReservations; i += 1) {
      await reserveOk(`KA01AB${2000 + i}`);
    }
    const res = await reserve('KA09ZZ9999');
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('RESERVATIONS_BUSY');
  });

  it('shows the held space in the public availability, by block and category', async () => {
    const before = (
      (await request(app).get('/api/v1/public/overview')).body as PublicOverviewResponse
    ).blockAvailability;
    const twoWheelerBefore = before.find((row) => row.blockCode === 'BLOCK-2W');
    expect(twoWheelerBefore).toMatchObject({ vehicleType: 'TWO_WHEELER', totalSlots: 10 });

    await reserveOk();
    const after = (
      (await request(app).get('/api/v1/public/overview')).body as PublicOverviewResponse
    ).blockAvailability.find((row) => row.blockCode === 'BLOCK-2W');
    expect(after?.availableSlots).toBe((twoWheelerBefore?.availableSlots ?? 0) - 1);
    expect(after?.totalSlots).toBe(10);
  });
});

describe("the visitor's own reservation", () => {
  it('is readable only with its own token', async () => {
    const { accessToken, reservation } = await reserveOk();
    const mine = await status(accessToken);
    expect(mine.status).toBe(200);
    expect((mine.body as VisitorReservationStatusResponse).reservation.reservationId).toBe(
      reservation.reservationId,
    );
    expect((mine.body as VisitorReservationStatusResponse).session).toBeNull();

    expect((await request(app).get('/api/v1/visitor/reservation')).status).toBe(401);
    const student = await createParkingUser();
    expect((await status(student.token)).status).toBe(401);
    expect((await status(guardToken)).status).toBe(401);
  });

  it('a reservation token does not open any session route, and a session token does not open a reservation', async () => {
    const { accessToken } = await reserveOk();
    const asSession = await request(app).get('/api/v1/visitor/session').set(bearer(accessToken));
    expect(asSession.status).toBe(401);

    const parked = await guard.checkInOk('KA05EF9012', 'TWO_WHEELER', 'VISITOR', 9);
    const access = await client(app).post('/visitor/access', {
      vehicleNumber: 'KA05EF9012',
      sessionNumber: parked.session.sessionNumber,
    });
    const sessionToken = (access.body as { accessToken: string }).accessToken;
    expect((await status(sessionToken)).status).toBe(401);
  });

  it('releases the held slot when the visitor cancels, and cancelling twice is harmless', async () => {
    const { accessToken, reservation } = await reserveOk();
    const cancel = () =>
      request(app).delete('/api/v1/visitor/reservation').set(bearer(accessToken));
    const first = await cancel();
    expect(first.status).toBe(200);
    expect((first.body as { status: string }).status).toBe('CANCELLED');
    expect((await slotState(reservation.slotCode)).status).toBe('AVAILABLE');
    expect((await cancel()).status).toBe(200);
    expect(
      await prisma.auditLog.count({ where: { action: 'VISITOR_RESERVATION_CANCELLED' } }),
    ).toBe(1);

    // The same vehicle may reserve again.
    expect((await reserve()).status).toBe(201);
  });

  it('lets an abandoned reservation lapse and returns the slot to the pool', async () => {
    const { accessToken, reservation } = await reserveOk();
    const past = new Date(Date.now() - 1_000);
    await prisma.visitorReservation.updateMany({ data: { expiresAt: past } });
    await prisma.parkingSlot.update({
      where: { code: reservation.slotCode },
      data: { holdExpiresAt: past },
    });

    const lapsed = await status(accessToken);
    expect((lapsed.body as VisitorReservationStatusResponse).reservation.status).toBe('EXPIRED');
    expect((lapsed.body as VisitorReservationStatusResponse).reservation.qrReference).toBeNull();
    expect((await slotState(reservation.slotCode)).status).toBe('AVAILABLE');

    // Security can no longer activate it, and the slot is free for the next vehicle.
    const res = await activate(reservation.reservationId);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('RESERVATION_EXPIRED');
    expect(await prisma.parkingSession.count()).toBe(0);
  });
});

describe('Security verifies the arrival and activates the session', () => {
  it('finds the arrival by its QR or by vehicle number and lists pending arrivals', async () => {
    const { reservation } = await reserveOk();
    const byQr = await find({ qr: entryQrPayload(reservation.qrReference!) });
    expect(byQr.status).toBe(200);
    expect((byQr.body as ArrivalResponse).arrival).toMatchObject({
      reservationId: reservation.reservationId,
      vehicleNumber: 'KA22AB1234',
      contactPhone: '+919876543210',
      slotCode: reservation.slotCode,
      block: { code: 'BLOCK-2W' },
    });
    expect((byQr.body as ArrivalResponse).matchedBy).toBe('ENTRY_QR');

    const byPlate = await find({ vehicleNumber: 'ka-22-ab-1234' });
    expect(byPlate.status).toBe(200);
    expect((byPlate.body as ArrivalResponse).matchedBy).toBe('VEHICLE_NUMBER');

    const pending = await request(app)
      .get('/api/v1/parking/arrivals/pending')
      .set(bearer(guardToken));
    expect((pending.body as PendingArrivalsResponse).arrivals).toHaveLength(1);
  });

  it('refuses unknown QR codes, unknown plates and malformed lookups', async () => {
    const unknownQr = await find({ qr: `cpvts:session:${'B'.repeat(43)}` });
    expect(unknownQr.status).toBe(400);
    expect(errorCode(unknownQr)).toBe('INVALID_QR_REFERENCE');
    const unknownPlate = await find({ vehicleNumber: 'KA09ZZ9999' });
    expect(unknownPlate.status).toBe(404);
    expect(errorCode(unknownPlate)).toBe('RESERVATION_NOT_FOUND');
    expect((await find({})).status).toBe(400);
    expect((await find({ qr: 'x', vehicleNumber: 'KA22AB1234' })).status).toBe(400);
  });

  it('only Security Staff can look up or activate arrivals', async () => {
    const { reservation, accessToken } = await reserveOk();
    const student = await createParkingUser();
    const admin = await signIn('ADMIN', 'boss');
    const body = { vehicleNumber: 'KA22AB1234' };

    expect((await request(app).post('/api/v1/parking/arrivals/find').send(body)).status).toBe(401);
    expect((await find(body, student.token)).status).toBe(403);
    expect((await find(body, admin.token)).status).toBe(403);
    expect((await find(body, accessToken)).status).toBe(401);

    expect(
      (await request(app).post(`/api/v1/parking/arrivals/${reservation.reservationId}/activate`))
        .status,
    ).toBe(401);
    expect((await activate(reservation.reservationId, student.token)).status).toBe(403);
    expect((await activate(reservation.reservationId, accessToken)).status).toBe(401);
    expect(await prisma.parkingSession.count()).toBe(0);
  });

  it('activates exactly once: the held slot becomes occupied and the visitor keeps the same QR', async () => {
    const { reservation, accessToken } = await reserveOk();
    const res = await activate(reservation.reservationId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const session = (res.body as ActivateArrivalResponse).session;

    expect(session).toMatchObject({
      status: 'ACTIVE',
      ownerCategory: 'VISITOR',
      vehicleNumber: 'KA22AB1234',
      slotCode: reservation.slotCode,
    });
    expect((await slotState(reservation.slotCode)).status).toBe('OCCUPIED');
    // The reservation QR is now the Parking Session QR.
    expect(session.entryReference).toBe(reservation.qrReference);

    // A second activation (a double tap, a second guard) changes nothing.
    const again = await activate(reservation.reservationId);
    expect(again.status).toBe(409);
    expect(await prisma.parkingSession.count()).toBe(1);

    // The visitor's status now carries a session token for the existing visitor routes.
    const mine = (await status(accessToken)).body as VisitorReservationStatusResponse;
    expect(mine.reservation).toMatchObject({
      status: 'ACTIVATED',
      sessionNumber: session.sessionNumber,
    });
    expect(mine.session?.sessionNumber).toBe(session.sessionNumber);
    const own = await request(app)
      .get('/api/v1/visitor/session')
      .set(bearer(mine.session!.accessToken));
    expect(own.status).toBe(200);
    const ownSession = own.body as ParkingSessionView;
    expect(ownSession.sessionNumber).toBe(session.sessionNumber);
    // The timer counts from the moment Security activated, not from the reservation.
    expect(new Date(ownSession.entryAt).getTime()).toBeGreaterThanOrEqual(
      new Date(reservation.expiresAt).getTime() - config.parking.visitorHoldMs - 1_000,
    );
    expect(await prisma.auditLog.count({ where: { action: 'VISITOR_ARRIVAL_ACTIVATED' } })).toBe(1);
  });

  it('does not activate when the held slot was lost, and starts no session', async () => {
    const { reservation } = await reserveOk();
    await prisma.parkingSlot.update({
      where: { code: reservation.slotCode },
      data: { status: 'AVAILABLE', holdToken: null, holdExpiresAt: null },
    });
    const res = await activate(reservation.reservationId);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('RESERVATION_EXPIRED');
    expect(await prisma.parkingSession.count()).toBe(0);
    const row = await prisma.visitorReservation.findUniqueOrThrow({
      where: { id: reservation.reservationId },
    });
    expect(row.status).toBe('HELD'); // the failed activation rolled back completely
  });

  it('runs the whole visit: QR checkout, correct visitor fee, one receipt, slot released once', async () => {
    const { reservation, accessToken } = await reserveOk('KA01CD5678');
    const { session } = (await activate(reservation.reservationId)).body as ActivateArrivalResponse;

    // At the exit gate the same QR identifies the active session.
    const scanned = await guard.scan(entryQrPayload(reservation.qrReference!));
    expect(scanned.status).toBe(200);
    expect((scanned.body as ScanCheckoutResponse).session.sessionNumber).toBe(
      session.sessionNumber,
    );

    // Visitor two-wheeler: ₹20 per started hour, from the first hour.
    const done = await guard.checkOutOk(session.sessionNumber, session.entryHour + 2);
    expect(done.payment.status).toBe('PAID');
    expect(done.receipt?.totalPaise).toBe(4_000);
    expect(await prisma.receipt.count()).toBe(1);
    expect((await slotState(reservation.slotCode)).status).toBe('AVAILABLE');

    // The visitor sees the receipt through their session-scoped token; nobody else's.
    const mine = (await status(accessToken)).body as VisitorReservationStatusResponse;
    const receipt = await request(app)
      .get('/api/v1/visitor/receipt')
      .set(bearer(mine.session!.accessToken));
    expect(receipt.status).toBe(200);
    expect((receipt.body as { totalPaise: number }).totalPaise).toBe(4_000);

    // A second checkout of the finished session is refused.
    const quote = await guard.quote({
      sessionNumber: session.sessionNumber,
      exitHour: session.entryHour + 2,
    });
    expect(quote.status).toBe(409);
    expect(await prisma.receipt.count()).toBe(1);
  });
});
