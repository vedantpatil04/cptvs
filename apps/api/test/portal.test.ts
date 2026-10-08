import type {
  ApiErrorBody,
  CheckoutQuote,
  CreatePaymentResponse,
  HistoryItem,
  NotificationsResponse,
  Page,
  ParkingUserProfileView,
  ParkNowConfirmation,
  ParkNowOffer,
  PortalLayoutResponse,
  PortalOverview,
  ProcessPaymentResponse,
  ReceiptView,
  RegisteredVehicle,
  SessionTimelineResponse,
  VehiclesResponse,
} from '@cpvts/shared';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { campusHour } from '../src/lib/campus-time.js';
import { tokenService } from '../src/modules/auth/token.service.js';
import { resetDatabase } from './helpers.js';
import {
  parkingApi,
  seedFees,
  seedLayout,
  setSlotStatus,
  signIn,
  slotStatus,
} from './parking-helpers.js';
import {
  adminAccount,
  client,
  createParkingUser,
  createParkingUserWithVehicle,
  errorCode,
  nextInstantAtCampusHour,
} from './user-helpers.js';

const app = createApp(config);
let admin: ReturnType<typeof client>;
let guard: ReturnType<typeof parkingApi>;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  admin = client(app, (await adminAccount()).token);
  guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(disconnectDatabase);

const offerOf = (res: { body: unknown }) => res.body as ParkNowOffer;

const parkNow = async (portal: ReturnType<typeof client>, vehicleId: string) => {
  const started = await portal.post('/portal/park-now/offers', { vehicleId });
  if (started.status !== 201) throw new Error(`start failed: ${JSON.stringify(started.body)}`);
  const confirmed = await portal.post('/portal/park-now/confirm', {
    offerId: offerOf(started).offerId,
  });
  if (confirmed.status !== 201)
    throw new Error(`confirm failed: ${JSON.stringify(confirmed.body)}`);
  return { offer: offerOf(started), ...(confirmed.body as ParkNowConfirmation) };
};

/** Fake only the clock, to a moment whose campus hour is `hour`, and re-issue the token for it. */
const clockAtHour = (hour: number, user: { id: string; tokenVersion: number }) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(nextInstantAtCampusHour(hour));
  return client(app, tokenService.issueAccessToken(user.id, user.tokenVersion).token);
};

describe('profile', () => {
  it('edits name, phone and language only', async () => {
    const { token } = await createParkingUser();
    const portal = client(app, token);
    const res = await portal.patch('/portal/profile', {
      fullName: 'Asha P',
      phone: '98450 54321',
      preferredLocale: 'kn',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fullName: 'Asha P',
      phone: '9845054321',
      preferredLocale: 'kn',
      category: 'STUDENT',
    });
  });

  it.each([
    { category: 'STAFF' },
    { verificationStatus: 'VERIFIED' },
    { verification: { status: 'VERIFIED' } },
    { email: 'new@college.edu.in' },
    { institutionalId: 'EMP-1' },
    { role: 'ADMIN' },
  ])('refuses to change protected fields %j', async (body) => {
    const { token, user } = await createParkingUser({ verification: 'PENDING' });
    const res = await client(app, token).patch('/portal/profile', body);
    expect(res.status).toBe(400);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { parkingProfile: true },
    });
    expect(stored.role).toBe('PARKING_USER');
    expect(stored.parkingProfile).toMatchObject({
      category: 'STUDENT',
      verificationStatus: 'PENDING',
    });
  });
});

describe('vehicles', () => {
  it('registers vehicles, making the first one primary', async () => {
    const { token } = await createParkingUser();
    const portal = client(app, token);

    const first = await portal.post('/portal/vehicles', {
      vehicleNumber: 'ka-22 ab 1234',
      vehicleType: 'TWO_WHEELER',
      label: ' My scooter ',
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      label: 'My scooter',
      isPrimary: true,
      identityEditable: true,
      activeSession: null,
    });

    const second = await portal.post('/portal/vehicles', {
      vehicleNumber: 'KA01CD5678',
      vehicleType: 'FOUR_WHEELER',
    });
    expect((second.body as RegisteredVehicle).isPrimary).toBe(false);

    const list = (await portal.get('/portal/vehicles')).body as VehiclesResponse;
    expect(list.vehicles.map((v) => v.vehicleNumber)).toEqual(['KA22AB1234', 'KA01CD5678']);
  });

  it('switches the primary vehicle (only one at a time)', async () => {
    const { token } = await createParkingUser();
    const portal = client(app, token);
    await portal.post('/portal/vehicles', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
    });
    const second = (
      await portal.post('/portal/vehicles', {
        vehicleNumber: 'KA01CD5678',
        vehicleType: 'FOUR_WHEELER',
      })
    ).body as RegisteredVehicle;

    const res = await portal.post(`/portal/vehicles/${second.id}/primary`);
    expect(res.status).toBe(200);
    const list = (await portal.get('/portal/vehicles')).body as VehiclesResponse;
    expect(list.vehicles.filter((v) => v.isPrimary).map((v) => v.vehicleNumber)).toEqual([
      'KA01CD5678',
    ]);
    expect(list.vehicles[0]?.vehicleNumber).toBe('KA01CD5678');
  });

  it('validates the number and type', async () => {
    const { token } = await createParkingUser();
    const portal = client(app, token);
    const bad = await portal.post('/portal/vehicles', {
      vehicleNumber: 'HELLO',
      vehicleType: 'TWO_WHEELER',
    });
    expect((bad.body as ApiErrorBody).error.details).toContainEqual({
      path: 'body.vehicleNumber',
      message: 'validation.invalidVehicleNumber',
    });
    const bus = await portal.post('/portal/vehicles', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'BUS',
    });
    expect(bus.status).toBe(400);
  });

  it('never registers a plate twice, and never shows it to another user', async () => {
    const a = await createParkingUser({ institutionalId: '2BT22CS001' });
    const b = await createParkingUser({ institutionalId: '2BT22CS002' });
    const body = { vehicleNumber: 'KA22AB1234', vehicleType: 'TWO_WHEELER' };
    const mine = await client(app, a.token).post('/portal/vehicles', body);
    expect(mine.status).toBe(201);

    expect(errorCode(await client(app, b.token).post('/portal/vehicles', body))).toBe(
      'VEHICLE_ALREADY_REGISTERED',
    );
    expect(errorCode(await client(app, a.token).post('/portal/vehicles', body))).toBe(
      'VEHICLE_ALREADY_REGISTERED',
    );
    expect(
      ((await client(app, b.token).get('/portal/vehicles')).body as VehiclesResponse).vehicles,
    ).toEqual([]);
  });

  it("hides another user's vehicle completely", async () => {
    const a = await createParkingUserWithVehicle(app, { institutionalId: '2BT22CS001' });
    const b = await createParkingUser({ institutionalId: '2BT22CS002' });
    const portal = client(app, b.token);
    expect(
      errorCode(await portal.patch(`/portal/vehicles/${a.vehicle.id}`, { label: 'mine now' })),
    ).toBe('VEHICLE_NOT_FOUND');
    expect(errorCode(await portal.post(`/portal/vehicles/${a.vehicle.id}/primary`))).toBe(
      'VEHICLE_NOT_FOUND',
    );
    expect(
      errorCode(await portal.post('/portal/park-now/offers', { vehicleId: a.vehicle.id })),
    ).toBe('VEHICLE_NOT_FOUND');
  });

  it('edits the label always, and the number or type only before any parking history', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);

    const edited = await portal.patch(`/portal/vehicles/${vehicle.id}`, {
      label: 'Scooter',
      vehicleNumber: 'KA22AB9999',
      vehicleType: 'FOUR_WHEELER',
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      label: 'Scooter',
      vehicleNumber: 'KA22AB9999',
      vehicleType: 'FOUR_WHEELER',
    });

    await portal.patch(`/portal/vehicles/${vehicle.id}`, { vehicleType: 'TWO_WHEELER' });
    await parkNow(portal, vehicle.id);
    const locked = await portal.patch(`/portal/vehicles/${vehicle.id}`, {
      vehicleNumber: 'KA22AB0001',
    });
    expect(errorCode(locked)).toBe('VEHICLE_IDENTITY_LOCKED');
    const labelOnly = await portal.patch(`/portal/vehicles/${vehicle.id}`, {
      label: 'Still editable',
    });
    expect(labelOnly.status).toBe(200);
    expect((labelOnly.body as RegisteredVehicle).identityEditable).toBe(false);
  });

  it.each([
    { ownerCategory: 'STAFF' },
    { isPrimary: true },
    { ownerUserId: '00000000-0000-4000-8000-000000000000' },
    { feeAmountPaise: 0 },
    { slotCode: 'T-01' },
    { sessionNumber: 'CPVTS-P-00000000' },
    { receiptNumber: 'CPVTS-R-2026-00000000' },
    { verificationStatus: 'VERIFIED' },
  ])('cannot change protected data through a vehicle edit: %j', async (body) => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const res = await client(app, token).patch(`/portal/vehicles/${vehicle.id}`, body);
    expect(res.status).toBe(400);
  });

  it('lets a user claim a plate the security desk has seen, without seeing older history', async () => {
    const old = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 9);
    await guard.checkOutOk(old.session.sessionNumber, 11);

    const { token } = await createParkingUser();
    const portal = client(app, token);
    expect(
      (
        await portal.post('/portal/vehicles', {
          vehicleNumber: 'KA22AB1234',
          vehicleType: 'TWO_WHEELER',
        })
      ).status,
    ).toBe(201);

    const history = (await portal.get('/portal/history')).body as Page<HistoryItem>;
    expect(history.total).toBe(0);
    expect(errorCode(await portal.get(`/portal/sessions/${old.session.sessionNumber}`))).toBe(
      'SESSION_NOT_FOUND',
    );
  });

  it('refuses to claim a plate registered with a different vehicle type', async () => {
    await guard.checkInOk('KA22AB1234', 'FOUR_WHEELER', 'VISITOR', 9);
    const { token } = await createParkingUser();
    const res = await client(app, token).post('/portal/vehicles', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
    });
    expect(errorCode(res)).toBe('VEHICLE_TYPE_MISMATCH');
  });

  it('limits how many vehicles one user can register', async () => {
    const { token } = await createParkingUser();
    const portal = client(app, token);
    for (let i = 0; i < 5; i += 1) {
      const res = await portal.post('/portal/vehicles', {
        vehicleNumber: `KA01AB100${i}`,
        vehicleType: 'TWO_WHEELER',
      });
      expect(res.status).toBe(201);
    }
    const sixth = await portal.post('/portal/vehicles', {
      vehicleNumber: 'KA01AB1009',
      vehicleType: 'TWO_WHEELER',
    });
    expect(errorCode(sixth)).toBe('VEHICLE_LIMIT_REACHED');
  });
});

describe('Park Now', () => {
  it('allocates automatically, holds the slot, then confirms into an active session', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);

    const started = await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id });
    expect(started.status).toBe(201);
    const offer = offerOf(started);
    expect(offer).toMatchObject({
      ownerCategory: 'STUDENT',
      vehicle: { id: vehicle.id, vehicleNumber: 'KA22AB1234', vehicleType: 'TWO_WHEELER' },
      block: { code: 'BLOCK-2W' },
      allocation: { slotCode: 'T-01', fallbacks: 0, candidatesConsidered: 10 },
    });
    expect(offer.allocation.checks).toContain('FINAL_AVAILABILITY_VERIFIED');
    expect(new Date(offer.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // The slot is held — not yet occupied, and no session exists.
    expect(await slotStatus('T-01')).toBe('HELD');
    expect(await prisma.parkingSession.count()).toBe(0);

    // Resume after a reload.
    const current = await portal.get('/portal/park-now/offer');
    expect((current.body as { offer: ParkNowOffer }).offer.offerId).toBe(offer.offerId);

    const confirmed = await portal.post('/portal/park-now/confirm', { offerId: offer.offerId });
    expect(confirmed.status).toBe(201);
    const { session, allocation } = confirmed.body as ParkNowConfirmation;
    expect(session).toMatchObject({
      status: 'ACTIVE',
      vehicleNumber: 'KA22AB1234',
      ownerCategory: 'STUDENT',
      slotCode: 'T-01',
      entryHour: campusHour(),
      block: { code: 'BLOCK-2W' },
    });
    expect(session.sessionNumber).toMatch(/^CPVTS-P-[0-9A-Z]{8}$/);
    expect(session.entryReference).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(allocation.slotCode).toBe('T-01');
    expect(await slotStatus('T-01')).toBe('OCCUPIED');
    expect(
      ((await portal.get('/portal/park-now/offer')).body as { offer: unknown }).offer,
    ).toBeNull();

    // The transaction trail: a self-service check-in and slot assignment.
    const stored = await prisma.parkNowOffer.findUniqueOrThrow({ where: { id: offer.offerId } });
    expect(stored.status).toBe('CONFIRMED');
    const checkIn = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'VEHICLE_CHECKED_IN' },
    });
    expect(checkIn.metadata).toMatchObject({
      via: 'SELF_SERVICE',
      categorySource: 'ACCOUNT',
      ownerCategory: 'STUDENT',
      offerId: offer.offerId,
    });
    expect(await prisma.auditLog.count({ where: { action: 'SLOT_ASSIGNED' } })).toBe(1);
  });

  it('ignores any slot the user tries to pick', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const res = await client(app, token).post('/portal/park-now/offers', {
      vehicleId: vehicle.id,
      slotCode: 'T-07',
      slotId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).toBe(201);
    expect(offerOf(res).allocation.slotCode).toBe('T-01');
  });

  it('bills Campus Staff as STAFF', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app, {
      category: 'STAFF',
      vehicleNumber: 'KA01EF0001',
    });
    const { session, offer } = await parkNow(client(app, token), vehicle.id);
    expect(offer.ownerCategory).toBe('STAFF');
    expect(session.ownerCategory).toBe('STAFF');
  });

  it('parks a four-wheeler in the four-wheeler zone', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app, {
      vehicleNumber: 'KA01CD5678',
      vehicleType: 'FOUR_WHEELER',
    });
    const { session } = await parkNow(client(app, token), vehicle.id);
    expect(session.slotCode).toBe('F-01');
  });

  it('uses the same engine as the desk: held slots are skipped, and the desk skips held slots', async () => {
    const a = await createParkingUserWithVehicle(app, { institutionalId: '2BT22CS001' });
    const b = await createParkingUserWithVehicle(app, {
      institutionalId: '2BT22CS002',
      vehicleNumber: 'KA01AB0002',
    });
    const first = await client(app, a.token).post('/portal/park-now/offers', {
      vehicleId: a.vehicle.id,
    });
    expect(offerOf(first).allocation.slotCode).toBe('T-01');

    // The desk cannot take the held slot…
    expect((await guard.checkInOk('KA01XY0001')).session.slotCode).toBe('T-02');
    // …and neither can the next Park Now user.
    const second = await client(app, b.token).post('/portal/park-now/offers', {
      vehicleId: b.vehicle.id,
    });
    expect(offerOf(second).allocation.slotCode).toBe('T-03');
  });

  it('refuses a vehicle that is already parked', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    await parkNow(portal, vehicle.id);
    const again = await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id });
    expect(errorCode(again)).toBe('DUPLICATE_ACTIVE_VEHICLE');
    expect(await prisma.auditLog.count({ where: { action: 'INTEGRITY_REJECTED' } })).toBe(1);
  });

  it('refuses a vehicle the desk has already parked', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    await guard.checkInOk('KA22AB1234');
    expect(
      errorCode(
        await client(app, token).post('/portal/park-now/offers', { vehicleId: vehicle.id }),
      ),
    ).toBe('DUPLICATE_ACTIVE_VEHICLE');
  });

  it('keeps one open offer per user: starting again replaces it and frees its slot', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const first = offerOf(await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }));
    const second = offerOf(await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }));

    expect(second.offerId).not.toBe(first.offerId);
    expect(
      (await prisma.parkNowOffer.findUniqueOrThrow({ where: { id: first.offerId } })).status,
    ).toBe('CANCELLED');
    expect(await prisma.parkNowOffer.count({ where: { status: 'OFFERED' } })).toBe(1);
    expect(await prisma.parkingSlot.count({ where: { status: 'HELD' } })).toBe(1);
    // The abandoned offer can no longer be confirmed.
    expect(
      errorCode(await portal.post('/portal/park-now/confirm', { offerId: first.offerId })),
    ).toBe('OFFER_NOT_FOUND');
  });

  it('cancelling returns the slot to the pool at once', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const offer = offerOf(await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }));
    expect((await portal.post('/portal/park-now/cancel', { offerId: offer.offerId })).status).toBe(
      204,
    );

    expect(await slotStatus('T-01')).toBe('AVAILABLE');
    expect(
      errorCode(await portal.post('/portal/park-now/confirm', { offerId: offer.offerId })),
    ).toBe('OFFER_NOT_FOUND');
    expect(
      errorCode(await portal.post('/portal/park-now/cancel', { offerId: offer.offerId })),
    ).toBe('OFFER_NOT_FOUND');
    expect(await prisma.auditLog.count({ where: { action: 'PARK_NOW_CANCELLED' } })).toBe(1);
  });

  it('lets an unconfirmed offer lapse: the slot returns and confirming fails', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const offer = offerOf(await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }));

    // Let the hold run out (move it and the offer into the past).
    await prisma.$executeRawUnsafe(
      `UPDATE park_now_offers SET created_at = now() - interval '5 minutes', expires_at = now() - interval '1 minute'`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE parking_slots SET hold_expires_at = now() - interval '1 minute' WHERE status = 'HELD'`,
    );

    expect(
      ((await portal.get('/portal/park-now/offer')).body as { offer: unknown }).offer,
    ).toBeNull();
    const confirm = await portal.post('/portal/park-now/confirm', { offerId: offer.offerId });
    expect(errorCode(confirm)).toBe('OFFER_EXPIRED');
    expect(await slotStatus('T-01')).toBe('AVAILABLE');
    expect(
      (await prisma.parkNowOffer.findUniqueOrThrow({ where: { id: offer.offerId } })).status,
    ).toBe('EXPIRED');
    expect(await prisma.parkingSession.count()).toBe(0);

    // The user simply starts again.
    expect(
      offerOf(await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id })).allocation
        .slotCode,
    ).toBe('T-01');
  });

  it('confirms an offer only once', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const { offer } = await parkNow(portal, vehicle.id);
    expect(
      errorCode(await portal.post('/portal/park-now/confirm', { offerId: offer.offerId })),
    ).toBe('OFFER_NOT_FOUND');
    expect(await prisma.parkingSession.count()).toBe(1);
  });

  it("does not let anyone act on another user's offer", async () => {
    const a = await createParkingUserWithVehicle(app, { institutionalId: '2BT22CS001' });
    const b = await createParkingUser({ institutionalId: '2BT22CS002' });
    const offer = offerOf(
      await client(app, a.token).post('/portal/park-now/offers', { vehicleId: a.vehicle.id }),
    );

    const other = client(app, b.token);
    expect(
      errorCode(await other.post('/portal/park-now/confirm', { offerId: offer.offerId })),
    ).toBe('OFFER_NOT_FOUND');
    expect(errorCode(await other.post('/portal/park-now/cancel', { offerId: offer.offerId }))).toBe(
      'OFFER_NOT_FOUND',
    );
    expect(await slotStatus('T-01')).toBe('HELD');
  });

  it('reports a full zone and picks up a slot the administrator adds, with no code change', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    for (let n = 1; n <= 10; n += 1)
      await setSlotStatus(`T-${String(n).padStart(2, '0')}`, 'OCCUPIED');

    expect(errorCode(await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }))).toBe(
      'ZONE_FULL',
    );

    const created = await admin.post('/admin/slots', {
      zoneCode: 'ZONE-2W',
      vehicleType: 'TWO_WHEELER',
      code: 't-11',
    });
    expect(created.status).toBe(201);
    const { session } = await parkNow(portal, vehicle.id);
    expect(session.slotCode).toBe('T-11');
  });

  it('skips blocked slots', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    await admin.post('/admin/slots/T-01/block', { reason: 'Repairs' });
    expect(
      offerOf(await client(app, token).post('/portal/park-now/offers', { vehicleId: vehicle.id }))
        .allocation.slotCode,
    ).toBe('T-02');
  });

  it('reports an unconfigured zone', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    await admin.patch('/admin/zones/ZONE-2W', { isActive: false });
    expect(
      errorCode(
        await client(app, token).post('/portal/park-now/offers', { vehicleId: vehicle.id }),
      ),
    ).toBe('ZONE_NOT_CONFIGURED');
  });

  it('gives simultaneous users different slots and never double-books', async () => {
    const people = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        createParkingUserWithVehicle(app, {
          institutionalId: `2BT22CS${String(100 + i)}`,
          vehicleNumber: `KA01AB${1000 + i}`,
        }),
      ),
    );
    const results = await Promise.all(
      people.map((p) =>
        client(app, p.token).post('/portal/park-now/offers', { vehicleId: p.vehicle.id }),
      ),
    );

    const offered = results.filter((r) => r.status === 201);
    const slots = offered.map((r) => offerOf(r).allocation.slotCode);
    expect(offered).toHaveLength(10);
    expect(new Set(slots).size).toBe(10);
    for (const refused of results.filter((r) => r.status !== 201)) {
      expect(['ZONE_FULL', 'ALLOCATION_FAILED']).toContain(errorCode(refused));
    }
    expect(await prisma.parkingSlot.count({ where: { status: 'HELD' } })).toBe(10);

    // Everyone who holds a slot can confirm; each gets their own.
    const confirmed = await Promise.all(
      offered.map((r, i) =>
        client(app, people[results.indexOf(r)]!.token).post('/portal/park-now/confirm', {
          offerId: offerOf(offered[i]!).offerId,
        }),
      ),
    );
    expect(confirmed.every((r) => r.status === 201)).toBe(true);
    expect(await prisma.parkingSlot.count({ where: { status: 'OCCUPIED' } })).toBe(10);
    expect(await prisma.parkingSession.count({ where: { status: 'ACTIVE' } })).toBe(10);
  });

  it('confirms an offer exactly once when confirmation is sent twice at the same moment', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const offer = offerOf(await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }));

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        portal.post('/portal/park-now/confirm', { offerId: offer.offerId }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const refused of results.filter((r) => r.status !== 201)) {
      expect(['OFFER_NOT_FOUND', 'OFFER_EXPIRED', 'DUPLICATE_ACTIVE_VEHICLE']).toContain(
        errorCode(refused),
      );
    }
    expect(await prisma.parkingSession.count({ where: { status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.parkingSlot.count({ where: { status: 'OCCUPIED' } })).toBe(1);
    expect(await prisma.parkingSlot.count({ where: { status: 'HELD' } })).toBe(0);
  });

  it('never leaves two slots held when the same user starts twice at the same moment', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }),
      ),
    );
    expect(results.some((r) => r.status === 201)).toBe(true);
    for (const refused of results.filter((r) => r.status !== 201)) expect(refused.status).toBe(409);

    expect(await prisma.parkNowOffer.count({ where: { status: 'OFFERED' } })).toBeLessThanOrEqual(
      1,
    );
    // Every held slot is backed by exactly one open offer: nothing leaks.
    const held = await prisma.parkingSlot.count({ where: { status: 'HELD' } });
    expect(held).toBe(await prisma.parkNowOffer.count({ where: { status: 'OFFERED' } }));
  });

  it('adds the session to the overview, active list, layout and notifications', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const other = await guard.checkInOk('MH12ZZ9999');
    const portal = client(app, token);
    const { session } = await parkNow(portal, vehicle.id);

    const overview = (await portal.get('/portal/overview')).body as PortalOverview;
    expect(overview.vehicleCount).toBe(1);
    expect(overview.activeSessions.map((s) => s.sessionNumber)).toEqual([session.sessionNumber]);
    expect(overview.availability.map((a) => a.vehicleType)).toEqual([
      'TWO_WHEELER',
      'FOUR_WHEELER',
    ]);
    expect(overview.recentActivity[0]?.sessionNumber).toBe(session.sessionNumber);

    const vehicles = (await portal.get('/portal/vehicles')).body as VehiclesResponse;
    expect(vehicles.vehicles[0]?.activeSession).toMatchObject({
      sessionNumber: session.sessionNumber,
      slotCode: session.slotCode,
    });

    const notices = (await portal.get('/portal/notifications')).body as NotificationsResponse;
    expect(notices.items[0]).toMatchObject({
      kind: 'PARKING_STARTED',
      params: { sessionNumber: session.sessionNumber, slotCode: session.slotCode },
    });

    // The layout marks the user's slot and shows nobody's vehicle.
    const layout = (await portal.get('/portal/layout')).body as PortalLayoutResponse;
    expect(layout.mySlots).toEqual([session.slotCode]);
    const text = JSON.stringify(layout);
    expect(text).not.toContain('MH12ZZ9999');
    expect(text).not.toContain(other.session.sessionNumber);
    expect(text).not.toContain('KA22AB1234');
    const occupied = layout.blocks
      .flatMap((b) => b.zones.flatMap((z) => z.slots))
      .filter((s) => s.status === 'OCCUPIED');
    expect(occupied.length).toBe(2);
    expect(occupied.every((s) => s.occupant === null)).toBe(true);
  });

  it('is for verified accounts only, and not for operational roles', async () => {
    const pending = await createParkingUser({ verification: 'PENDING' });
    const res = await client(app, pending.token).post('/portal/park-now/offers', {
      vehicleId: '00000000-0000-4000-8000-000000000000',
    });
    expect(errorCode(res)).toBe('VERIFICATION_REQUIRED');

    const boss = (await adminAccount('boss3')).token;
    expect((await client(app, boss).post('/portal/park-now/offers', {})).status).toBe(403);
    expect((await client(app).post('/portal/park-now/offers', {})).status).toBe(401);
  });
});

describe('self-service checkout, payment and receipt', () => {
  it('runs the whole student journey: Park Now → check out → pay → receipt → history', async () => {
    const { token, user, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const { session } = await parkNow(portal, vehicle.id);

    // Same hour: nothing to pay, so the only method is NO_CHARGE.
    const quote = (
      await portal.post('/portal/checkout/quote', {
        sessionNumber: session.sessionNumber,
        exitHour: 23,
      })
    ).body as CheckoutQuote;
    expect(quote.exitHour).toBe(campusHour()); // the user cannot pick the exit hour
    expect(quote.fee.totalPaise).toBe(0);

    const wrongMethod = await portal.post('/portal/checkout/payments', {
      sessionNumber: session.sessionNumber,
      method: 'UPI',
    });
    expect(errorCode(wrongMethod)).toBe('INVALID_PAYMENT_METHOD');

    const created = await portal.post('/portal/checkout/payments', {
      sessionNumber: session.sessionNumber,
      method: 'NO_CHARGE',
    });
    expect(created.status).toBe(201);
    const { payment } = created.body as CreatePaymentResponse;
    expect(payment).toMatchObject({ status: 'PENDING', amountPaise: 0, isSimulated: true });

    const processed = await portal.post(`/portal/checkout/payments/${payment.id}/process`, {
      sessionNumber: session.sessionNumber,
    });
    expect(processed.status).toBe(200);
    const { receipt } = processed.body as ProcessPaymentResponse;
    expect(receipt).toMatchObject({
      sessionNumber: session.sessionNumber,
      vehicleNumber: 'KA22AB1234',
      slotCode: session.slotCode,
      totalPaise: 0,
      payment: { status: 'PAID', method: 'NO_CHARGE' },
    });

    // Finalized: session completed, slot released, how it happened recorded.
    expect(await slotStatus(session.slotCode)).toBe('AVAILABLE');
    const stored = await prisma.parkingSession.findUniqueOrThrow({
      where: { sessionNumber: session.sessionNumber },
    });
    expect(stored).toMatchObject({
      status: 'COMPLETED',
      checkedOutById: user.id,
      checkedOutVia: 'SELF_SERVICE',
    });

    // Receipts and history.
    const receipts = (await portal.get('/portal/receipts')).body as Page<HistoryItem>;
    expect(receipts.items.map((r) => r.receiptNumber)).toEqual([receipt!.receiptNumber]);
    const detail = await portal.get(`/portal/receipts/${receipt!.receiptNumber}`);
    expect((detail.body as ReceiptView).verificationReference).toBe(receipt!.verificationReference);
    const history = (await portal.get('/portal/history')).body as Page<HistoryItem>;
    expect(history.items[0]).toMatchObject({
      sessionNumber: session.sessionNumber,
      status: 'COMPLETED',
      receiptNumber: receipt!.receiptNumber,
      paymentStatus: 'PAID',
      slotCode: session.slotCode,
    });

    // Notifications: session started, receipt generated.
    const notices = (await portal.get('/portal/notifications')).body as NotificationsResponse;
    expect(notices.items.map((n) => n.kind).sort()).toEqual([
      'PARKING_STARTED',
      'RECEIPT_GENERATED',
    ]);
    expect(notices.items.find((n) => n.kind === 'RECEIPT_GENERATED')?.params).toMatchObject({
      receiptNumber: receipt!.receiptNumber,
    });

    // The vehicle is free to park again (the engine spreads use: T-01 was used today).
    expect(
      ((await portal.get('/portal/sessions/active')).body as { sessions: unknown[] }).sessions,
    ).toEqual([]);
    expect((await parkNow(portal, vehicle.id)).session.slotCode).toBe('T-02');
  });

  it('charges the official student rate from the backend fee engine (2W 09→15 = ₹40)', async () => {
    const { token, user, vehicle } = await createParkingUserWithVehicle(app);
    // The desk checks the student's scooter in at 09:00; the owner checks out at 15:00.
    const entry = await guard.checkInOk(vehicle.vehicleNumber, 'TWO_WHEELER', 'VISITOR', 9);
    expect(entry.session.ownerCategory).toBe('STUDENT'); // the account decides, not the desk

    const portal = clockAtHour(15, user);
    void token;
    const quote = (
      await portal.post('/portal/checkout/quote', { sessionNumber: entry.session.sessionNumber })
    ).body as CheckoutQuote;
    expect(quote).toMatchObject({ exitHour: 15, durationHours: 6 });
    expect(quote.fee).toMatchObject({ totalPaise: 4000, durationHours: 6 });
    expect(quote.fee.lines).toEqual([
      { kind: 'FREE', hours: 2 },
      { kind: 'CHARGED', hours: 4, ratePaise: 1000, amountPaise: 4000 },
    ]);

    // A declined payment leaves the session active and can be retried.
    const first = (
      await portal.post('/portal/checkout/payments', {
        sessionNumber: entry.session.sessionNumber,
        method: 'UPI',
      })
    ).body as CreatePaymentResponse;
    const declined = await portal.post(`/portal/checkout/payments/${first.payment.id}/process`, {
      sessionNumber: entry.session.sessionNumber,
      outcome: 'FAILURE',
    });
    expect((declined.body as ProcessPaymentResponse).payment.status).toBe('FAILED');
    expect((declined.body as ProcessPaymentResponse).receipt).toBeNull();
    expect(await slotStatus(entry.session.slotCode)).toBe('OCCUPIED');

    const second = (
      await portal.post('/portal/checkout/payments', {
        sessionNumber: entry.session.sessionNumber,
        method: 'CARD',
      })
    ).body as CreatePaymentResponse;
    const paid = await portal.post(`/portal/checkout/payments/${second.payment.id}/process`, {
      sessionNumber: entry.session.sessionNumber,
    });
    const { receipt, payment } = paid.body as ProcessPaymentResponse;
    expect(payment).toMatchObject({ status: 'PAID', amountPaise: 4000, method: 'CARD' });
    expect(receipt).toMatchObject({
      totalPaise: 4000,
      durationHours: 6,
      exitHour: 15,
      entryHour: 9,
    });
    expect(receipt?.payment.transactionId).toMatch(/^TXN-/);

    const record = await prisma.parkingSession.findUniqueOrThrow({
      where: { sessionNumber: entry.session.sessionNumber },
    });
    expect(record).toMatchObject({ feeAmountPaise: 4000, checkedOutVia: 'SELF_SERVICE' });
  });

  it('charges Campus Staff nothing', async () => {
    const { user, vehicle } = await createParkingUserWithVehicle(app, {
      category: 'STAFF',
      vehicleNumber: 'KA01EF0001',
      vehicleType: 'FOUR_WHEELER',
    });
    const entry = await guard.checkInOk(vehicle.vehicleNumber, 'FOUR_WHEELER', 'VISITOR', 8);
    expect(entry.session.ownerCategory).toBe('STAFF');

    const portal = clockAtHour(17, user);
    const quote = (
      await portal.post('/portal/checkout/quote', { sessionNumber: entry.session.sessionNumber })
    ).body as CheckoutQuote;
    expect(quote.fee).toMatchObject({ totalPaise: 0, durationHours: 9 });
    const { payment } = (
      await portal.post('/portal/checkout/payments', {
        sessionNumber: entry.session.sessionNumber,
        method: 'NO_CHARGE',
      })
    ).body as CreatePaymentResponse;
    const done = await portal.post(`/portal/checkout/payments/${payment.id}/process`, {
      sessionNumber: entry.session.sessionNumber,
    });
    expect((done.body as ProcessPaymentResponse).receipt?.totalPaise).toBe(0);
  });

  it('cancels a pending payment', async () => {
    const { user, vehicle } = await createParkingUserWithVehicle(app);
    const entry = await guard.checkInOk(vehicle.vehicleNumber, 'TWO_WHEELER', 'STUDENT', 9);
    const portal = clockAtHour(14, user);
    const { payment } = (
      await portal.post('/portal/checkout/payments', {
        sessionNumber: entry.session.sessionNumber,
        method: 'UPI',
      })
    ).body as CreatePaymentResponse;
    const cancelled = await portal.post(`/portal/checkout/payments/${payment.id}/cancel`, {
      sessionNumber: entry.session.sessionNumber,
    });
    expect((cancelled.body as { payment: { status: string } }).payment.status).toBe('CANCELLED');
  });

  it("cannot check out someone else's session or use their payment", async () => {
    const a = await createParkingUserWithVehicle(app, { institutionalId: '2BT22CS001' });
    const b = await createParkingUserWithVehicle(app, {
      institutionalId: '2BT22CS002',
      vehicleNumber: 'KA01AB0002',
    });
    const entryA = await guard.checkInOk(a.vehicle.vehicleNumber, 'TWO_WHEELER', 'STUDENT', 9);
    const entryB = await guard.checkInOk(b.vehicle.vehicleNumber, 'TWO_WHEELER', 'STUDENT', 9);
    const portalA = clockAtHour(15, a.user);
    const portalB = client(
      app,
      tokenService.issueAccessToken(b.user.id, b.user.tokenVersion).token,
    );

    const { payment } = (
      await portalA.post('/portal/checkout/payments', {
        sessionNumber: entryA.session.sessionNumber,
        method: 'UPI',
      })
    ).body as CreatePaymentResponse;

    // B asking about A's session looks exactly like asking about a session that does not exist.
    const sessionA = entryA.session.sessionNumber;
    expect(
      errorCode(await portalB.post('/portal/checkout/quote', { sessionNumber: sessionA })),
    ).toBe('SESSION_NOT_FOUND');
    expect(
      errorCode(
        await portalB.post('/portal/checkout/payments', { sessionNumber: sessionA, method: 'UPI' }),
      ),
    ).toBe('SESSION_NOT_FOUND');
    expect(
      errorCode(
        await portalB.post(`/portal/checkout/payments/${payment.id}/process`, {
          sessionNumber: sessionA,
        }),
      ),
    ).toBe('SESSION_NOT_FOUND');
    // B using their own session number with A's payment id is also "not found".
    expect(
      errorCode(
        await portalB.post(`/portal/checkout/payments/${payment.id}/process`, {
          sessionNumber: entryB.session.sessionNumber,
        }),
      ),
    ).toBe('PAYMENT_NOT_FOUND');
    expect(
      errorCode(
        await portalB.post(`/portal/checkout/payments/${payment.id}/cancel`, {
          sessionNumber: entryB.session.sessionNumber,
        }),
      ),
    ).toBe('PAYMENT_NOT_FOUND');
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({
      status: 'PENDING',
    });
  });

  it('cannot check out after midnight with the whole-hour model', async () => {
    const { user, vehicle } = await createParkingUserWithVehicle(app);
    const entry = await guard.checkInOk(vehicle.vehicleNumber, 'TWO_WHEELER', 'STUDENT', 22);
    const portal = clockAtHour(5, user);
    const res = await portal.post('/portal/checkout/quote', {
      sessionNumber: entry.session.sessionNumber,
    });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('EXIT_BEFORE_ENTRY' as never);
  });

  it('shows the owner a timeline without staff names or internal refusals', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const { session } = await parkNow(portal, vehicle.id);
    await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }); // refused: already parked

    const timeline = (await portal.get(`/portal/sessions/${session.sessionNumber}/timeline`))
      .body as SessionTimelineResponse;
    expect(timeline.events.map((e) => e.action)).toEqual(['VEHICLE_CHECKED_IN', 'SLOT_ASSIGNED']);
    expect(timeline.events.every((e) => e.actor === null && e.channel === 'SELF_SERVICE')).toBe(
      true,
    );

    // The security view of the same session keeps names and the refusal-free trail.
    const staffView = (
      await client(app, (await signIn('SECURITY_STAFF', 'guard9')).token).get(
        `/parking/sessions/${session.sessionNumber}/timeline`,
      )
    ).body as SessionTimelineResponse;
    expect(staffView.events[0]?.actor?.role).toBe('PARKING_USER');
  });
});

describe('history and receipts', () => {
  const finishedStudent = async () => {
    const account = await createParkingUserWithVehicle(app, { institutionalId: '2BT22CS001' });
    const entry = await guard.checkInOk(account.vehicle.vehicleNumber, 'TWO_WHEELER', 'STUDENT', 9);
    const portal = clockAtHour(13, account.user);
    const { payment } = (
      await portal.post('/portal/checkout/payments', {
        sessionNumber: entry.session.sessionNumber,
        method: 'UPI',
      })
    ).body as CreatePaymentResponse;
    const done = (
      await portal.post(`/portal/checkout/payments/${payment.id}/process`, {
        sessionNumber: entry.session.sessionNumber,
      })
    ).body as ProcessPaymentResponse;
    vi.useRealTimers();
    return { ...account, entry, receipt: done.receipt!, portal: client(app, account.token) };
  };

  it('lists only the user’s own sessions, with filters and pagination', async () => {
    const mine = await finishedStudent();
    const second = await createParkingUser({ institutionalId: '2BT22CS002' });
    const theirs = client(app, second.token);
    await theirs.post('/portal/vehicles', {
      vehicleNumber: 'KA01CD5678',
      vehicleType: 'FOUR_WHEELER',
    });
    await guard.checkInOk('KA01CD5678', 'FOUR_WHEELER', 'STUDENT', 10);

    const history = (await mine.portal.get('/portal/history')).body as Page<HistoryItem>;
    expect(history.total).toBe(1);
    expect(history.items[0]).toMatchObject({
      vehicleNumber: 'KA22AB1234',
      feePaise: 2000,
      durationHours: 4,
    });

    const byType = (await mine.portal.get('/portal/history', { vehicleType: 'FOUR_WHEELER' }))
      .body as Page<HistoryItem>;
    expect(byType.total).toBe(0);
    const byNumber = (await mine.portal.get('/portal/history', { vehicleNumber: 'ka22' }))
      .body as Page<HistoryItem>;
    expect(byNumber.total).toBe(1);
    const future = (await mine.portal.get('/portal/history', { from: '2999-01-01' }))
      .body as Page<HistoryItem>;
    expect(future.total).toBe(0);

    const other = (await theirs.get('/portal/history')).body as Page<HistoryItem>;
    expect(other.items.map((i) => i.vehicleNumber)).toEqual(['KA01CD5678']);
    expect(JSON.stringify(other)).not.toContain('KA22AB1234');

    const paged = (await mine.portal.get('/portal/history', { page: 2, pageSize: 1 }))
      .body as Page<HistoryItem>;
    expect(paged).toMatchObject({ page: 2, pageSize: 1, total: 1, items: [] });
  });

  it("does not show another user's session, receipt or timeline", async () => {
    const mine = await finishedStudent();
    const intruder = await createParkingUser({ institutionalId: '2BT22CS003' });
    const other = client(app, intruder.token);
    const sessionNumber = mine.entry.session.sessionNumber;

    expect(errorCode(await other.get(`/portal/sessions/${sessionNumber}`))).toBe(
      'SESSION_NOT_FOUND',
    );
    expect(errorCode(await other.get(`/portal/sessions/${sessionNumber}/timeline`))).toBe(
      'SESSION_NOT_FOUND',
    );
    expect(errorCode(await other.get(`/portal/receipts/${mine.receipt.receiptNumber}`))).toBe(
      'RECEIPT_NOT_FOUND',
    );
    expect(((await other.get('/portal/receipts')).body as Page<HistoryItem>).total).toBe(0);
    expect(
      ((await other.get('/portal/sessions/active')).body as { sessions: unknown[] }).sessions,
    ).toEqual([]);
  });

  it('returns the full receipt for the owner', async () => {
    const mine = await finishedStudent();
    const receipt = (await mine.portal.get(`/portal/receipts/${mine.receipt.receiptNumber}`))
      .body as ReceiptView;
    expect(receipt).toMatchObject({
      vehicleNumber: 'KA22AB1234',
      ownerCategory: 'STUDENT',
      entryHour: 9,
      exitHour: 13,
      durationHours: 4,
      totalPaise: 2000,
      block: { code: 'BLOCK-2W' },
      payment: { status: 'PAID', method: 'UPI', isSimulated: true },
    });
    expect(receipt.fee.lines).toHaveLength(2);
  });
});

describe('profile of a rejected account', () => {
  it('still shows the rejection reason and keeps parking features locked', async () => {
    const { token } = await createParkingUser({
      verification: 'REJECTED',
      note: 'ID photo is cropped',
    });
    const portal = client(app, token);
    const profile = (await portal.get('/portal/profile')).body as ParkingUserProfileView;
    expect(profile.verification).toMatchObject({ status: 'REJECTED', note: 'ID photo is cropped' });
    expect(errorCode(await portal.get('/portal/vehicles'))).toBe('VERIFICATION_REQUIRED');
  });
});
