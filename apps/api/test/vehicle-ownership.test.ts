import type {
  AdminVehicleItem,
  HistoryItem,
  Page,
  ParkNowOffer,
  RegisteredVehicle,
  VehicleReleaseResult,
  VehiclesResponse,
} from '@cpvts/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
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
let admin: ReturnType<typeof client>;
let guard: ReturnType<typeof parkingApi>;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  admin = client(app, (await adminAccount()).token);
  guard = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
});

afterAll(disconnectDatabase);

const register = (token: string, vehicleNumber: string, vehicleType = 'TWO_WHEELER') =>
  client(app, token).post('/portal/vehicles', { vehicleNumber, vehicleType });

describe('a plate is actively owned by one account at a time', () => {
  it('refuses a second account (and a repeat), however the plate is written', async () => {
    const a = await createParkingUser({ institutionalId: '2BT22CS001' });
    const b = await createParkingUser({ institutionalId: '2BT22CS002' });

    const first = await register(a.token, 'ka-22 ab 1234');
    expect(first.status).toBe(201);
    expect((first.body as RegisteredVehicle).vehicleNumber).toBe('KA22AB1234');

    for (const [token, plate] of [
      [b.token, 'KA22AB1234'],
      [b.token, 'ka22ab1234'],
      [b.token, 'KA 22 AB 1234'],
      [a.token, 'KA22AB1234'], // the owner registering it again
    ] as const) {
      const res = await register(token, plate);
      expect(res.status, plate).toBe(409);
      expect(errorCode(res)).toBe('VEHICLE_ALREADY_REGISTERED');
    }
    const rows = await prisma.vehicle.findMany({ where: { vehicleNumber: 'KA22AB1234' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownerUserId).toBe(a.user.id);
  });

  it('lets exactly one of two simultaneous registrations win', async () => {
    const a = await createParkingUser({ institutionalId: '2BT22CS001' });
    const b = await createParkingUser({ institutionalId: '2BT22CS002' });
    const results = await Promise.all([
      register(a.token, 'KA22AB1234'),
      register(b.token, 'KA22AB1234'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const rows = await prisma.vehicle.findMany({ where: { vehicleNumber: 'KA22AB1234' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownerUserId).toBe(results[0]?.status === 201 ? a.user.id : b.user.id);
  });

  it('takes the owner from the sign-in, never from the request body', async () => {
    const a = await createParkingUser({ institutionalId: '2BT22CS001' });
    const b = await createParkingUser({ institutionalId: '2BT22CS002' });
    const res = await client(app, a.token).post('/portal/vehicles', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      ownerUserId: b.user.id,
      isPrimary: false,
      category: 'STAFF',
    });
    expect(res.status).toBe(201);
    expect(
      (await prisma.vehicle.findUniqueOrThrow({ where: { vehicleNumber: 'KA22AB1234' } }))
        .ownerUserId,
    ).toBe(a.user.id);
    expect((res.body as RegisteredVehicle).isPrimary).toBe(true); // the first vehicle is primary
  });

  it('keeps an unverified account from registering vehicles at all', async () => {
    const pending = await createParkingUser({ verification: 'PENDING' });
    expect(errorCode(await register(pending.token, 'KA22AB1234'))).toBe('VERIFICATION_REQUIRED');
    expect(await prisma.vehicle.count()).toBe(0);
  });

  it('gives a user no way to edit the category, verification, slot, fee, session or payment', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    for (const field of [
      { category: 'STAFF' },
      { verificationStatus: 'VERIFIED' },
      { ownerCategory: 'STAFF' },
      { slotId: 'T-01' },
      { feeAmountPaise: 0 },
      { sessionNumber: 'CPVTS-P-00000000' },
      { ownerUserId: '00000000-0000-4000-8000-000000000001' },
    ]) {
      const res = await client(app, token).patch(`/portal/vehicles/${vehicle.id}`, field);
      expect(res.status, JSON.stringify(field)).toBe(400);
    }
  });
});

describe('removing a vehicle', () => {
  it('deletes a vehicle that never parked and hands the primary mark to the next one', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    expect((await register(token, 'KA01CD5678')).status).toBe(201);

    const removed = await client(app, token).delete(`/portal/vehicles/${vehicle.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body as VehicleReleaseResult).toEqual({
      vehicleNumber: 'KA22AB1234',
      outcome: 'DELETED',
    });
    expect(await prisma.vehicle.count({ where: { vehicleNumber: 'KA22AB1234' } })).toBe(0);

    const list = (await client(app, token).get('/portal/vehicles')).body as VehiclesResponse;
    expect(list.vehicles.map((v) => [v.vehicleNumber, v.isPrimary])).toEqual([
      ['KA01CD5678', true],
    ]);
  });

  it('refuses to remove a vehicle that is parked right now', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    await guard.checkInOk(vehicle.vehicleNumber, 'TWO_WHEELER', 'STUDENT', 9);
    const res = await client(app, token).delete(`/portal/vehicles/${vehicle.id}`);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('VEHICLE_PARKED');
    expect(
      (await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).ownerUserId,
    ).not.toBeNull();
  });

  it('releases a vehicle with history: the owner keeps their sessions and receipts, the next owner starts clean', async () => {
    const first = await createParkingUserWithVehicle(app, { institutionalId: '2BT22CS001' });
    const entry = await guard.checkInOk(first.vehicle.vehicleNumber, 'TWO_WHEELER', 'STUDENT', 9);
    const done = await guard.checkOutOk(entry.session.sessionNumber, 13, 'UPI');
    const oldOwner = client(app, first.token);

    const released = await oldOwner.delete(`/portal/vehicles/${first.vehicle.id}`);
    expect(released.body as VehicleReleaseResult).toEqual({
      vehicleNumber: 'KA22AB1234',
      outcome: 'RELEASED',
    });
    const row = await prisma.vehicle.findUniqueOrThrow({ where: { id: first.vehicle.id } });
    expect(row).toMatchObject({ ownerUserId: null, ownerSince: null, isPrimary: false });

    // The previous owner can no longer act on the vehicle, but still sees what they did.
    expect(
      errorCode(await oldOwner.patch(`/portal/vehicles/${first.vehicle.id}`, { label: 'x' })),
    ).toBe('VEHICLE_NOT_FOUND');
    expect(((await oldOwner.get('/portal/history')).body as Page<HistoryItem>).total).toBe(1);
    expect(
      ((await oldOwner.get('/portal/receipts')).body as Page<HistoryItem>).items[0]?.receiptNumber,
    ).toBe(done.receipt!.receiptNumber);

    // Another account registers the plate: they own it from now on, and see none of the past.
    const second = await createParkingUser({ institutionalId: '2BT22CS002' });
    expect((await register(second.token, 'KA22AB1234')).status).toBe(201);
    const newOwner = client(app, second.token);
    expect(((await newOwner.get('/portal/history')).body as Page<HistoryItem>).total).toBe(0);

    const next = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 10);
    expect(next.categorySource).toBe('ACCOUNT');
    expect(((await newOwner.get('/portal/history')).body as Page<HistoryItem>).total).toBe(1);
    // …and the previous owner does not see the new owner's session.
    expect(((await oldOwner.get('/portal/history')).body as Page<HistoryItem>).total).toBe(1);
  });

  it('cancels an open Park Now offer when the vehicle is removed, returning its slot', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const offer = (await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }))
      .body as ParkNowOffer;
    const heldSlot = offer.allocation.slotCode;
    expect(await slotStatus(heldSlot)).toBe('HELD');

    expect((await portal.delete(`/portal/vehicles/${vehicle.id}`)).status).toBe(200);
    expect(await slotStatus(heldSlot)).toBe('AVAILABLE');
    expect(await prisma.parkNowOffer.count({ where: { status: 'OFFERED' } })).toBe(0);
  });

  it("is invisible to everyone else: another account gets 'not found'", async () => {
    const { vehicle } = await createParkingUserWithVehicle(app, { institutionalId: '2BT22CS001' });
    const other = await createParkingUser({ institutionalId: '2BT22CS002' });
    const res = await client(app, other.token).delete(`/portal/vehicles/${vehicle.id}`);
    expect(errorCode(res)).toBe('VEHICLE_NOT_FOUND');
    expect(await prisma.vehicle.count({ where: { id: vehicle.id } })).toBe(1);
  });
});

describe('every session remembers the account that owned the vehicle', () => {
  it('records the owner on desk sessions and on Park Now sessions alike', async () => {
    const { user, token, vehicle } = await createParkingUserWithVehicle(app);
    const desk = await guard.checkInOk(vehicle.vehicleNumber, 'TWO_WHEELER', 'VISITOR', 9);
    expect(
      (
        await prisma.parkingSession.findUniqueOrThrow({
          where: { sessionNumber: desk.session.sessionNumber },
        })
      ).ownerUserId,
    ).toBe(user.id);
    await guard.checkOutOk(desk.session.sessionNumber, 9);

    const portal = client(app, token);
    const offer = (await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }))
      .body as ParkNowOffer;
    const confirmed = await portal.post('/portal/park-now/confirm', { offerId: offer.offerId });
    const sessionNumber = (confirmed.body as { session: { sessionNumber: string } }).session
      .sessionNumber;
    expect(
      (await prisma.parkingSession.findUniqueOrThrow({ where: { sessionNumber } })).ownerUserId,
    ).toBe(user.id);

    // A plate nobody owns leaves no owner behind.
    const stranger = await guard.checkInOk('KA09ZZ0001', 'TWO_WHEELER', 'VISITOR', 9);
    expect(
      (
        await prisma.parkingSession.findUniqueOrThrow({
          where: { sessionNumber: stranger.session.sessionNumber },
        })
      ).ownerUserId,
    ).toBeNull();
  });
});

describe('Admin looks up who owns a plate', () => {
  it('searches by (part of) the number and shows the one active owner', async () => {
    const a = await createParkingUserWithVehicle(app, {
      institutionalId: '2BT22CS001',
      fullName: 'Anil Owner',
      vehicleNumber: 'KA22AB1234',
    });
    await createParkingUserWithVehicle(app, {
      institutionalId: '2BT22CS002',
      fullName: 'Bhavya Owner',
      vehicleNumber: 'KA01CD5678',
    });
    await guard.checkInOk('KA09ZZ0001', 'TWO_WHEELER', 'VISITOR', 9); // seen by the desk, owned by nobody
    const entry = await guard.checkInOk(a.vehicle.vehicleNumber, 'TWO_WHEELER', 'STUDENT', 9);

    const found = (await admin.get('/admin/vehicles', { q: 'ka 22-ab' }))
      .body as Page<AdminVehicleItem>;
    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      owner: {
        fullName: 'Anil Owner',
        category: 'STUDENT',
        institutionalId: '2BT22CS001',
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
      sessionCount: 1,
      activeSession: {
        sessionNumber: entry.session.sessionNumber,
        slotCode: entry.session.slotCode,
      },
    });

    const owned = (await admin.get('/admin/vehicles', { owned: 'OWNED' }))
      .body as Page<AdminVehicleItem>;
    expect(owned.items.map((v) => v.vehicleNumber).sort()).toEqual(['KA01CD5678', 'KA22AB1234']);
    const unowned = (await admin.get('/admin/vehicles', { owned: 'UNOWNED' }))
      .body as Page<AdminVehicleItem>;
    expect(unowned.items.map((v) => [v.vehicleNumber, v.owner])).toEqual([['KA09ZZ0001', null]]);

    const one = (await admin.get(`/admin/vehicles/${found.items[0]!.id}`)).body as AdminVehicleItem;
    expect(one.owner?.userId).toBe(a.user.id);
    expect(errorCode(await admin.get('/admin/vehicles/00000000-0000-4000-8000-000000000000'))).toBe(
      'VEHICLE_NOT_FOUND',
    );
  });

  it('releases a plate on the owner’s behalf, audited, unless it is parked', async () => {
    const { vehicle, user } = await createParkingUserWithVehicle(app);
    await guard.checkInOk(vehicle.vehicleNumber, 'TWO_WHEELER', 'STUDENT', 9);
    expect(errorCode(await admin.post(`/admin/vehicles/${vehicle.id}/release`))).toBe(
      'VEHICLE_PARKED',
    );

    const session = (await guard.active()).body as { sessions: { sessionNumber: string }[] };
    await guard.checkOutOk(session.sessions[0]!.sessionNumber, 9);
    const res = await admin.post(`/admin/vehicles/${vehicle.id}/release`);
    expect(res.status).toBe(200);
    expect((res.body as VehicleReleaseResult).outcome).toBe('RELEASED');

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'VEHICLE_RELEASED' } });
    expect(audit.metadata).toMatchObject({
      by: 'ADMIN',
      ownerUserId: user.id,
      outcome: 'RELEASED',
    });
  });

  it('is for administrators only', async () => {
    const { vehicle, token } = await createParkingUserWithVehicle(app);
    const guardToken = (await signIn('SECURITY_STAFF', 'guard2')).token;
    for (const t of [token, guardToken]) {
      expect((await client(app, t).get('/admin/vehicles')).status).toBe(403);
      expect((await client(app, t).get(`/admin/vehicles/${vehicle.id}`)).status).toBe(403);
      expect((await client(app, t).post(`/admin/vehicles/${vehicle.id}/release`)).status).toBe(403);
    }
    expect((await client(app).get('/admin/vehicles')).status).toBe(401);
  });
});
