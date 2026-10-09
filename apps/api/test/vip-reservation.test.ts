import {
  type PublicOverviewResponse,
  type ScanCheckoutResponse,
  type SlotReservationsResponse,
  type SlotReservationView,
  type VipCheckInResponse,
  type VisitorReservationCreated,
  entryQrPayload,
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

const reserve = (body: Record<string, unknown>, token = guardToken) =>
  request(app).post('/api/v1/parking/vip-reservations').set(bearer(token)).send(body);

const reserveOk = async (slotCode = 'F-01', extra: Record<string, unknown> = {}) => {
  const res = await reserve({
    slotCode,
    guestName: 'Chief Guest, Annual Day',
    reason: 'Official guest of the Principal',
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as SlotReservationView;
};

const release = (id: string, body: Record<string, unknown> = {}, token = guardToken) =>
  request(app).post(`/api/v1/parking/vip-reservations/${id}/release`).set(bearer(token)).send(body);

const vipCheckIn = (id: string, body: Record<string, unknown>, token = guardToken) =>
  request(app)
    .post(`/api/v1/parking/vip-reservations/${id}/check-in`)
    .set(bearer(token))
    .send(body);

const slot = (code: string) => prisma.parkingSlot.findUniqueOrThrow({ where: { code } });

const visitorReserve = (vehicleNumber: string, vehicleType = 'FOUR_WHEELER') =>
  request(app)
    .post('/api/v1/public/visitor-reservations')
    .send({ vehicleNumber, vehicleType, contactPhone: '9876543210' });

describe('reserving and releasing a slot', () => {
  it('reserves one specific slot and records who, when and why', async () => {
    const view = await reserveOk('F-01', { vehicleNumber: 'ka-01-vp-0001' });

    expect(view).toMatchObject({
      slotCode: 'F-01',
      status: 'ACTIVE',
      slotStatus: 'RESERVED',
      vehicleNumber: 'KA01VP0001',
      guestName: 'Chief Guest, Annual Day',
      reason: 'Official guest of the Principal',
      reservedByName: expect.any(String),
      block: { code: 'BLOCK-4W' },
    });
    expect((await slot('F-01')).status).toBe('RESERVED');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'SLOT_RESERVED' } });
    expect(audit.entityId).toBe('F-01');
    expect(JSON.stringify(audit.metadata)).toContain('Official guest of the Principal');
  });

  it('persists the reservation in the database, not just in memory', async () => {
    const view = await reserveOk();
    const row = await prisma.slotReservation.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.status).toBe('ACTIVE');
    const listed = await request(app)
      .get('/api/v1/parking/vip-reservations')
      .set(bearer(guardToken));
    expect((listed.body as SlotReservationsResponse).reservations.map((r) => r.id)).toEqual([
      view.id,
    ]);
  });

  it('releases only when Security says so, and keeps the history', async () => {
    const view = await reserveOk();
    const released = await release(view.id, { note: 'Guest cancelled' });
    expect(released.status).toBe(200);
    expect(released.body).toMatchObject({ status: 'RELEASED', releaseNote: 'Guest cancelled' });
    expect((await slot('F-01')).status).toBe('AVAILABLE');

    // Active list is empty, history keeps who/when/why.
    const active = await request(app)
      .get('/api/v1/parking/vip-reservations')
      .set(bearer(guardToken));
    expect((active.body as SlotReservationsResponse).reservations).toHaveLength(0);
    const history = await request(app)
      .get('/api/v1/parking/vip-reservations?history=true')
      .set(bearer(guardToken));
    expect((history.body as SlotReservationsResponse).reservations[0]).toMatchObject({
      status: 'RELEASED',
      releasedByName: expect.any(String),
    });
    expect(await prisma.auditLog.count({ where: { action: 'SLOT_RESERVATION_RELEASED' } })).toBe(1);

    // Releasing twice is refused.
    expect((await release(view.id)).status).toBe(404);
  });

  it('refuses occupied, held, blocked, disabled, reserved and unknown slots without disturbing them', async () => {
    const parked = await guard.checkInOk('KA22AB1234', 'FOUR_WHEELER', 'VISITOR', 9);
    const occupiedCode = parked.session.slotCode;
    const occupied = await reserve({
      slotCode: occupiedCode,
      guestName: 'Guest',
      reason: 'Because',
    });
    expect(occupied.status).toBe(409);
    expect(errorCode(occupied)).toBe('SLOT_NOT_RESERVABLE');
    expect((await slot(occupiedCode)).status).toBe('OCCUPIED');
    expect(
      (await prisma.parkingSession.findFirstOrThrow({ where: { status: 'ACTIVE' } })).status,
    ).toBe('ACTIVE');

    await prisma.parkingSlot.update({
      where: { code: 'F-02' },
      data: { status: 'HELD', holdToken: 'x', holdExpiresAt: new Date(Date.now() + 60_000) },
    });
    await prisma.parkingSlot.update({
      where: { code: 'F-03' },
      data: { status: 'BLOCKED', blockedReason: 'Repair' },
    });
    await prisma.parkingSlot.update({ where: { code: 'F-04' }, data: { isEnabled: false } });
    for (const code of ['F-02', 'F-03', 'F-04']) {
      const res = await reserve({ slotCode: code, guestName: 'Guest', reason: 'Because' });
      expect(res.status, code).toBe(409);
      expect(errorCode(res), code).toBe('SLOT_NOT_RESERVABLE');
    }
    expect((await slot('F-02')).status).toBe('HELD');
    expect((await slot('F-03')).status).toBe('BLOCKED');

    await reserveOk('F-05');
    const again = await reserve({ slotCode: 'F-05', guestName: 'Guest', reason: 'Because' });
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('SLOT_NOT_RESERVABLE');

    const unknown = await reserve({ slotCode: 'F-99', guestName: 'Guest', reason: 'Because' });
    expect(unknown.status).toBe(404);
  });

  it('lets exactly one of several simultaneous reservations of the same slot succeed', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        reserve({ slotCode: 'F-01', guestName: `Guest ${i}`, reason: 'Race' }),
      ),
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    expect(results.filter((res) => res.status === 409)).toHaveLength(5);
    expect(await prisma.slotReservation.count({ where: { status: 'ACTIVE' } })).toBe(1);
  });

  it('validates the form', async () => {
    for (const body of [
      { guestName: 'Guest', reason: 'Because' },
      { slotCode: 'F-01', reason: 'Because' },
      { slotCode: 'F-01', guestName: 'Guest' },
      { slotCode: 'nope', guestName: 'Guest', reason: 'Because' },
      { slotCode: 'F-01', guestName: 'Guest', reason: 'Because', vehicleNumber: 'bad plate!' },
    ]) {
      expect((await reserve(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma.slotReservation.count()).toBe(0);
  });
});

describe('a reserved slot is never allocated automatically', () => {
  it('is skipped by the desk, Park My Vehicle and visitor reservations', async () => {
    // Reserve four of the five four-wheeler slots; only F-05 remains for everyone else.
    for (const code of ['F-01', 'F-02', 'F-03', 'F-04']) await reserveOk(code);

    const desk = await guard.checkInOk('KA01AA1111', 'FOUR_WHEELER', 'VISITOR', 9);
    expect(desk.session.slotCode).toBe('F-05');

    const owner = await createParkingUserWithVehicle(app, {
      vehicleNumber: 'KA02BB2222',
      vehicleType: 'FOUR_WHEELER',
    });
    const portal = client(app, owner.token);
    const offer = await portal.post('/portal/park-now/offers', { vehicleId: owner.vehicle.id });
    // F-05 is parked now, nothing is free: the reserved slots are not offered.
    expect(offer.status).toBe(409);
    expect(errorCode(offer)).toBe('ZONE_FULL');

    const visitor = await visitorReserve('KA03CC3333');
    expect(visitor.status).toBe(409);
    expect(errorCode(visitor)).toBe('ZONE_FULL');

    for (const code of ['F-01', 'F-02', 'F-03', 'F-04']) {
      expect((await slot(code)).status, code).toBe('RESERVED');
    }
  });

  it('is not counted as free in the public availability', async () => {
    const before = (
      (await request(app).get('/api/v1/public/overview')).body as PublicOverviewResponse
    ).availability.find((entry) => entry.vehicleType === 'FOUR_WHEELER');
    await reserveOk('F-01');
    const body = (await request(app).get('/api/v1/public/overview')).body as PublicOverviewResponse;
    const after = body.availability.find((entry) => entry.vehicleType === 'FOUR_WHEELER');
    expect(after?.availableSlots).toBe((before?.availableSlots ?? 0) - 1);
    expect(body.blockAvailability.find((row) => row.blockCode === 'BLOCK-4W')?.availableSlots).toBe(
      (before?.availableSlots ?? 0) - 1,
    );
    // The public response carries no reservation detail.
    expect(JSON.stringify(body)).not.toContain('Principal');
  });

  it('shows RESERVED distinctly on the Security map, with no detail on it', async () => {
    await reserveOk('F-01');
    const map = await guard.map();
    const zone = (
      map.body as {
        blocks: {
          zones: { slots: { code: string; status: string }[]; counts: { reserved?: number } }[];
        }[];
      }
    ).blocks
      .flatMap((b) => b.zones)
      .find((z) => z.slots.some((s) => s.code === 'F-01'))!;
    expect(zone.slots.find((s) => s.code === 'F-01')?.status).toBe('RESERVED');
    expect(zone.counts.reserved).toBe(1);
    expect(JSON.stringify(map.body)).not.toContain('Principal');
  });

  it('cannot be taken by a visitor reservation racing the reservation', async () => {
    for (const code of ['F-02', 'F-03', 'F-04', 'F-05']) {
      await prisma.parkingSlot.update({
        where: { code },
        data: { status: 'BLOCKED', blockedReason: 'x' },
      });
    }
    const results = await Promise.all([
      reserve({ slotCode: 'F-01', guestName: 'VIP', reason: 'Race' }),
      visitorReserve('KA03CC3333'),
    ]);
    const vip = results[0];
    const visitor = results[1];
    // Exactly one of them gets F-01.
    const vipWon = vip.status === 201;
    const visitorWon = visitor.status === 201;
    expect(vipWon !== visitorWon).toBe(true);
    if (vipWon) expect(errorCode(visitor)).toBe('ZONE_FULL');
    if (visitorWon)
      expect((visitor.body as VisitorReservationCreated).reservation.slotCode).toBe('F-01');
  });
});

describe('who may use it', () => {
  it('lets only Security reserve, release and check the VIP in; administrators can only view', async () => {
    const view = await reserveOk();
    const student = await createParkingUser();
    const admin = await signIn('ADMIN', 'boss');
    const body = { slotCode: 'F-02', guestName: 'Guest', reason: 'Because' };

    expect((await request(app).post('/api/v1/parking/vip-reservations').send(body)).status).toBe(
      401,
    );
    expect((await reserve(body, student.token)).status).toBe(403);
    expect((await reserve(body, admin.token)).status).toBe(403);
    expect((await release(view.id, {}, student.token)).status).toBe(403);
    expect((await release(view.id, {}, admin.token)).status).toBe(403);
    expect(
      (
        await vipCheckIn(
          view.id,
          { vehicleNumber: 'KA01VP0001', vehicleType: 'FOUR_WHEELER', confirmOfficialGuest: true },
          student.token,
        )
      ).status,
    ).toBe(403);
    expect((await slot('F-01')).status).toBe('RESERVED');
    expect((await slot('F-02')).status).toBe('AVAILABLE');

    // Administrators see status and history; other users see nothing.
    const adminView = await request(app)
      .get('/api/v1/parking/vip-reservations?history=true')
      .set(bearer(admin.token));
    expect(adminView.status).toBe(200);
    expect((adminView.body as SlotReservationsResponse).reservations[0]?.reason).toContain(
      'Principal',
    );
    expect(
      (await request(app).get('/api/v1/parking/vip-reservations').set(bearer(student.token)))
        .status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/parking/vip-reservations')).status).toBe(401);
  });
});

describe('the VIP arrives, parks and leaves', () => {
  it('only the designated vehicle may take the slot', async () => {
    const view = await reserveOk('F-01', { vehicleNumber: 'KA01VP0001' });
    const stranger = await vipCheckIn(view.id, {
      vehicleNumber: 'KA09ZZ9999',
      vehicleType: 'FOUR_WHEELER',
    });
    expect(stranger.status).toBe(409);
    expect(errorCode(stranger)).toBe('VIP_VEHICLE_MISMATCH');
    expect((await slot('F-01')).status).toBe('RESERVED');
    expect(await prisma.parkingSession.count()).toBe(0);

    // The wrong vehicle type for the zone is refused too.
    const wrongType = await vipCheckIn(view.id, {
      vehicleNumber: 'KA01VP0001',
      vehicleType: 'TWO_WHEELER',
    });
    expect(wrongType.status).toBe(409);
  });

  it('requires Security to confirm the guest when no vehicle was named', async () => {
    const view = await reserveOk('F-01');
    const unconfirmed = await vipCheckIn(view.id, {
      vehicleNumber: 'KA01VP0001',
      vehicleType: 'FOUR_WHEELER',
    });
    expect(unconfirmed.status).toBe(400);
    expect(errorCode(unconfirmed)).toBe('VIP_CONFIRMATION_REQUIRED');
    expect(await prisma.parkingSession.count()).toBe(0);

    const confirmed = await vipCheckIn(view.id, {
      vehicleNumber: 'KA01VP0001',
      vehicleType: 'FOUR_WHEELER',
      confirmOfficialGuest: true,
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
  });

  it('uses the normal session, QR, payment and receipt flow, and the slot stays reserved after checkout', async () => {
    const view = await reserveOk('F-01', { vehicleNumber: 'KA01VP0001' });
    const res = await vipCheckIn(view.id, {
      vehicleNumber: 'KA01VP0001',
      vehicleType: 'FOUR_WHEELER',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { session } = res.body as VipCheckInResponse;
    expect(session).toMatchObject({ status: 'ACTIVE', slotCode: 'F-01', ownerCategory: 'STAFF' });
    expect((await slot('F-01')).status).toBe('OCCUPIED');
    expect(
      await prisma.auditLog.count({
        where: { action: 'VIP_CHECKED_IN', entityId: session.sessionNumber },
      }),
    ).toBe(1);

    // It can not be released while the VIP is parked.
    const early = await release(view.id);
    expect(early.status).toBe(409);
    expect(errorCode(early)).toBe('VIP_SLOT_IN_USE');
    expect((await slot('F-01')).status).toBe('OCCUPIED');
    // And nobody else can take the occupied slot.
    expect(
      (await vipCheckIn(view.id, { vehicleNumber: 'KA01VP0001', vehicleType: 'FOUR_WHEELER' }))
        .status,
    ).toBe(409);

    // The existing QR scan and checkout work unchanged.
    const scanned = await guard.scan(entryQrPayload(session.entryReference!));
    expect(scanned.status).toBe(200);
    expect((scanned.body as ScanCheckoutResponse).session.sessionNumber).toBe(
      session.sessionNumber,
    );
    const done = await guard.checkOutOk(session.sessionNumber, session.entryHour + 2);
    expect(done.payment.status).toBe('PAID');
    expect(await prisma.receipt.count()).toBe(1);

    // After checkout the slot is RESERVED again, not AVAILABLE, and still out of every allocation.
    expect((await slot('F-01')).status).toBe('RESERVED');
    const row = await prisma.slotReservation.findUniqueOrThrow({ where: { id: view.id } });
    expect(row.status).toBe('ACTIVE');
    const other = await guard.checkInOk('KA02BB2222', 'FOUR_WHEELER', 'VISITOR', 9);
    expect(other.session.slotCode).not.toBe('F-01');

    // Only an explicit release frees it.
    const freed = await release(view.id, { note: 'Visit over' });
    expect(freed.status).toBe(200);
    expect((await slot('F-01')).status).toBe('AVAILABLE');
  });

  it('refuses a vehicle that is already parked elsewhere', async () => {
    await guard.checkInOk('KA01VP0001', 'FOUR_WHEELER', 'VISITOR', 9);
    const view = await reserveOk('F-05', { vehicleNumber: 'KA01VP0001' });
    const res = await vipCheckIn(view.id, {
      vehicleNumber: 'KA01VP0001',
      vehicleType: 'FOUR_WHEELER',
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('DUPLICATE_ACTIVE_VEHICLE');
    expect((await slot('F-05')).status).toBe('RESERVED');
  });
});
