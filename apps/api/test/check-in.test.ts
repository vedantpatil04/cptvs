import type {
  ApiErrorBody,
  CheckInResponse,
  ParkingMapResponse,
  TrackingResponse,
} from '@cpvts/shared';
import { entryQrPayload } from '@cpvts/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { slotHoldRepository } from '../src/modules/parking/slot-hold.repository.js';
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

const errorCode = (res: { body: unknown }) => (res.body as ApiErrorBody).error.code;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  api = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
});

afterAll(disconnectDatabase);

describe('vehicle check-in', () => {
  it('creates an active session in the best slot and marks it OCCUPIED', async () => {
    const { session, allocation } = await api.checkInOk('ka-22 ab 1234');

    expect(session).toMatchObject({
      status: 'ACTIVE',
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'STUDENT',
      slotCode: 'T-01',
      entryHour: 9,
      block: { code: 'BLOCK-2W', coordinates: null },
    });
    expect(session.sessionNumber).toMatch(/^CPVTS-P-[0-9A-Z]{8}$/);
    expect(session.entryReference).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(allocation).toMatchObject({ slotCode: 'T-01', fallbacks: 0, candidatesConsidered: 10 });
    expect(allocation.checks).toContain('FINAL_AVAILABILITY_VERIFIED');
    expect(await slotStatus('T-01')).toBe('OCCUPIED');
  });

  it('records check-in and slot assignment audit events', async () => {
    const { session } = await api.checkInOk('KA22AB1234');
    const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (entry) => [entry.action, entry.entityId],
    );
    expect(actions).toEqual([
      ['VEHICLE_CHECKED_IN', session.sessionNumber],
      ['SLOT_ASSIGNED', 'T-01'],
    ]);
  });

  it.each([
    [{ entryHour: 24 }, 'body.entryHour', 'validation.invalidHour'],
    [{ entryHour: -1 }, 'body.entryHour', 'validation.invalidHour'],
    [{ entryHour: 9.5 }, 'body.entryHour', 'validation.invalidHour'],
    [{ entryHour: '9' }, 'body.entryHour', 'validation.invalidHour'],
    [{ vehicleNumber: 'HELLO' }, 'body.vehicleNumber', 'validation.invalidVehicleNumber'],
    [{ vehicleNumber: '' }, 'body.vehicleNumber', 'validation.required'],
    [{ vehicleType: 'BUS' }, 'body.vehicleType', 'validation.selectOption'],
    [{ ownerCategory: 'FACULTY' }, 'body.ownerCategory', 'validation.selectOption'],
  ])('rejects invalid input %j', async (override, path, message) => {
    const res = await api.checkIn({
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'STUDENT',
      entryHour: 9,
      ...override,
    });
    expect(res.status).toBe(400);
    expect((res.body as ApiErrorBody).error.details).toContainEqual({ path, message });
    expect(await prisma.parkingSession.count()).toBe(0);
  });

  it('rejects a vehicle that is already parked and audits the rejection', async () => {
    await api.checkInOk('KA22AB1234');
    const res = await api.checkIn({
      vehicleNumber: 'KA 22 AB 1234',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 10,
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('DUPLICATE_ACTIVE_VEHICLE');
    expect(await prisma.parkingSession.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'INTEGRITY_REJECTED' } })).toBe(1);
  });

  it('assigns each vehicle type only to its own zone', async () => {
    expect((await api.checkInOk('KA01AB1111', 'FOUR_WHEELER')).session.slotCode).toBe('F-01');
    expect((await api.checkInOk('KA01AB2222', 'TWO_WHEELER')).session.slotCode).toBe('T-01');
  });

  it('rejects a vehicle number already registered with another vehicle type', async () => {
    const { session } = await api.checkInOk('KA01AB1111', 'FOUR_WHEELER');
    await api.checkOutOk(session.sessionNumber, 9);
    const res = await api.checkIn({
      vehicleNumber: 'KA01AB1111',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'STAFF',
      entryHour: 10,
    });
    expect(errorCode(res)).toBe('VEHICLE_TYPE_MISMATCH');
  });

  it('never allocates BLOCKED or OCCUPIED slots', async () => {
    await setSlotStatus('T-01', 'BLOCKED');
    await api.checkInOk('KA01AB0001'); // takes T-02
    const third = await api.checkInOk('KA01AB0002');
    expect(third.session.slotCode).toBe('T-03');
    expect(await slotStatus('T-01')).toBe('BLOCKED');
  });

  it('rejects entry when the correct zone is full, without using another zone', async () => {
    for (let i = 1; i <= 5; i += 1) await api.checkInOk(`KA01AB000${i}`, 'FOUR_WHEELER');
    const res = await api.checkIn({
      vehicleNumber: 'KA01AB0009',
      vehicleType: 'FOUR_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 9,
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ZONE_FULL');
    expect(
      await prisma.parkingSlot.count({ where: { status: 'OCCUPIED', code: { startsWith: 'T-' } } }),
    ).toBe(0);
  });

  it('treats a zone with only blocked slots as full', async () => {
    await prisma.parkingSlot.updateMany({
      where: { code: { startsWith: 'F-' } },
      data: { status: 'BLOCKED' },
    });
    const res = await api.checkIn({
      vehicleNumber: 'KA01AB0009',
      vehicleType: 'FOUR_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 9,
    });
    expect(errorCode(res)).toBe('ZONE_FULL');
  });

  it('reports an unconfigured zone', async () => {
    await prisma.parkingZone.updateMany({
      where: { vehicleType: 'FOUR_WHEELER' },
      data: { isActive: false },
    });
    const res = await api.checkIn({
      vehicleNumber: 'KA01AB0009',
      vehicleType: 'FOUR_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 9,
    });
    expect(errorCode(res)).toBe('ZONE_NOT_CONFIGURED');
  });

  it('spreads use across the zone: a slot used today ranks below an unused one', async () => {
    const first = await api.checkInOk('KA01AB0001');
    await api.checkOutOk(first.session.sessionNumber, 10);
    expect(await slotStatus('T-01')).toBe('AVAILABLE');
    const second = await api.checkInOk('KA01AB0002');
    expect(second.session.slotCode).toBe('T-02');
    expect(second.allocation.factors.usesToday).toBe(0);
  });

  it('honours admin-configured slot priority', async () => {
    await prisma.parkingSlot.update({ where: { code: 'T-07' }, data: { priority: 5 } });
    expect((await api.checkInOk('KA01AB0001')).session.slotCode).toBe('T-07');
  });
});

describe('temporary slot hold', () => {
  it('skips a slot currently held by another allocation', async () => {
    const slot = await prisma.parkingSlot.findUniqueOrThrow({ where: { code: 'T-01' } });
    expect(await slotHoldRepository.acquire(slot.id)).not.toBeNull();
    expect(await slotStatus('T-01')).toBe('HELD');
    expect((await api.checkInOk('KA01AB0001')).session.slotCode).toBe('T-02');
  });

  it('reclaims expired holds before allocating', async () => {
    await prisma.parkingSlot.update({
      where: { code: 'T-01' },
      data: { status: 'HELD', holdToken: 'stale', holdExpiresAt: new Date(Date.now() - 1000) },
    });
    expect((await api.checkInOk('KA01AB0001')).session.slotCode).toBe('T-01');
  });

  it('only the holder can confirm, and only before expiry, in a compatible zone', async () => {
    const slot = await prisma.parkingSlot.findUniqueOrThrow({ where: { code: 'T-01' } });
    const token = (await slotHoldRepository.acquire(slot.id))!;

    expect(await slotHoldRepository.acquire(slot.id)).toBeNull();
    expect(await slotHoldRepository.confirm(slot.id, 'wrong-token', 'TWO_WHEELER')).toBe(false);
    expect(await slotHoldRepository.confirm(slot.id, token, 'FOUR_WHEELER')).toBe(false);

    await prisma.parkingSlot.update({
      where: { id: slot.id },
      data: { holdExpiresAt: new Date(Date.now() - 1) },
    });
    expect(await slotHoldRepository.confirm(slot.id, token, 'TWO_WHEELER')).toBe(false);

    await prisma.parkingSlot.update({
      where: { id: slot.id },
      data: { holdExpiresAt: new Date(Date.now() + 10_000) },
    });
    expect(await slotHoldRepository.confirm(slot.id, token, 'TWO_WHEELER')).toBe(true);
    expect(await slotStatus('T-01')).toBe('OCCUPIED');
  });

  it('release only frees a slot for its holder', async () => {
    const slot = await prisma.parkingSlot.findUniqueOrThrow({ where: { code: 'T-01' } });
    const token = (await slotHoldRepository.acquire(slot.id))!;
    await slotHoldRepository.release(slot.id, 'someone-else');
    expect(await slotStatus('T-01')).toBe('HELD');
    await slotHoldRepository.release(slot.id, token);
    expect(await slotStatus('T-01')).toBe('AVAILABLE');
  });
});

describe('concurrent check-ins', () => {
  it('never gives two vehicles the same slot', async () => {
    const results = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        api.checkIn({
          vehicleNumber: `KA01AB10${i}0`,
          vehicleType: 'FOUR_WHEELER',
          ownerCategory: 'VISITOR',
          entryHour: 9,
        }),
      ),
    );
    const succeeded = results.filter((res) => res.status === 201);
    const slots = succeeded.map((res) => (res.body as CheckInResponse).session.slotCode);
    expect(succeeded).toHaveLength(5);
    expect(new Set(slots).size).toBe(5);
    for (const res of results.filter((r) => r.status !== 201)) {
      expect(['ZONE_FULL', 'ALLOCATION_FAILED']).toContain(errorCode(res));
    }
    expect(await prisma.parkingSlot.count({ where: { status: 'HELD' } })).toBe(0);
    expect(await prisma.parkingSlot.count({ where: { status: 'OCCUPIED' } })).toBe(5);
  });

  it('creates only one active session when the same vehicle is checked in twice at once', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        api.checkIn({
          vehicleNumber: 'KA01AB9999',
          vehicleType: 'TWO_WHEELER',
          ownerCategory: 'STUDENT',
          entryHour: 9,
        }),
      ),
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    for (const res of results.filter((r) => r.status !== 201)) {
      expect(errorCode(res)).toBe('DUPLICATE_ACTIVE_VEHICLE');
    }
    expect(await prisma.parkingSession.count({ where: { status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.parkingSlot.count({ where: { status: 'OCCUPIED' } })).toBe(1);
    expect(await prisma.parkingSlot.count({ where: { status: 'HELD' } })).toBe(0);
  });
});

describe('vehicle tracking', () => {
  let checkIn: CheckInResponse;
  beforeEach(async () => {
    checkIn = await api.checkInOk('KA22AB1234', 'TWO_WHEELER', 'STUDENT', 9);
  });

  it.each([
    ['vehicle number', 'ka 22 ab 1234', 'VEHICLE_NUMBER'],
    ['slot ID', 't-01', 'SLOT'],
  ])('finds the active vehicle by %s', async (_label, query, matchedBy) => {
    const res = await api.track(query);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      matchedBy,
      session: { vehicleNumber: 'KA22AB1234', slotCode: 'T-01', status: 'ACTIVE' },
    });
  });

  it('finds the session by session number and by entry QR', async () => {
    expect((await api.track(checkIn.session.sessionNumber)).body).toMatchObject({
      matchedBy: 'SESSION_NUMBER',
    });
    const qr = entryQrPayload(checkIn.session.entryReference!);
    const res = await api.track(qr);
    expect(res.body).toMatchObject({ matchedBy: 'ENTRY_QR', session: { slotCode: 'T-01' } });
  });

  it('includes live duration and an estimate from the fee engine', async () => {
    const { session } = (await api.track('KA22AB1234')).body as TrackingResponse;
    expect(session.currentHour).toEqual(expect.any(Number));
    expect(session.currentDurationHours).toBe(Math.max(0, session.currentHour! - 9));
    expect(session.estimatedFee?.durationHours).toBe(session.currentDurationHours);
  });

  it('rejects an unknown or forged entry QR', async () => {
    const res = await api.track(entryQrPayload('A'.repeat(43)));
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('INVALID_QR_REFERENCE');
    expect(errorCode(await api.track('cpvts:session:not-a-token'))).toBe('INVALID_QR_REFERENCE');
  });

  it('reports vehicles and slots without an active session', async () => {
    expect(errorCode(await api.track('KA01ZZ0000'))).toBe('SESSION_NOT_FOUND');
    expect(errorCode(await api.track('T-05'))).toBe('SESSION_NOT_FOUND');
    expect((await api.track('nonsense!!')).status).toBe(404);
  });

  it('lists active vehicles', async () => {
    await api.checkInOk('KA01AB0001', 'FOUR_WHEELER', 'VISITOR', 10);
    const res = await api.active();
    expect(res.body.sessions.map((s: { slotCode: string }) => s.slotCode).sort()).toEqual([
      'F-01',
      'T-01',
    ]);
  });

  it('returns the parking map with occupants for occupied slots only', async () => {
    await setSlotStatus('T-05', 'BLOCKED');
    const map = (await api.map()).body as ParkingMapResponse;
    const twoWheeler = map.blocks[0]!.zones[0]!;
    expect(twoWheeler.counts).toEqual({
      total: 10,
      available: 8,
      occupied: 1,
      blocked: 1,
      held: 0,
      reserved: 0,
    });
    const t01 = twoWheeler.slots.find((slot) => slot.code === 'T-01')!;
    expect(t01).toMatchObject({ status: 'OCCUPIED', occupant: { vehicleNumber: 'KA22AB1234' } });
    expect(twoWheeler.slots.find((slot) => slot.code === 'T-02')!.occupant).toBeNull();
    expect(map.blocks.map((block) => block.zones[0]!.slots.length)).toEqual([10, 5]);
  });
});
