import type {
  ApiErrorBody,
  ManagedBlock,
  ManagedLayout,
  ManagedSlot,
  PublicOverviewResponse,
  SlotDeletionResult,
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
let guardToken: string;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  admin = client(app, (await adminAccount()).token);
  guardToken = (await signIn('SECURITY_STAFF', 'guard')).token;
  guard = parkingApi(app, guardToken);
});

afterAll(disconnectDatabase);

const createSlot = (body: Record<string, unknown>) =>
  admin.post('/admin/slots', { zoneCode: 'ZONE-2W', vehicleType: 'TWO_WHEELER', ...body });

const layout = async (includeArchived = false) =>
  (await admin.get('/admin/layout', includeArchived ? { includeArchived: true } : {}))
    .body as ManagedLayout;

const findSlot = async (code: string, includeArchived = false) =>
  (await layout(includeArchived)).blocks
    .flatMap((b) => b.zones.flatMap((z) => z.slots))
    .find((s) => s.code === code);

const publicTotals = async () =>
  ((await client(app).get('/public/overview')).body as PublicOverviewResponse).availability;

/** Fills T-01…T-10 with desk sessions. */
const fillTwoWheelerZone = async () => {
  for (let i = 0; i < 10; i += 1) await guard.checkInOk(`KA01AB${1000 + i}`);
};

describe('creating a slot', () => {
  it('adds T-11 to the two-wheeler zone, at the end of the layout', async () => {
    const res = await createSlot({ code: 't-11', priority: 11 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      code: 'T-11',
      status: 'AVAILABLE',
      priority: 11,
      isEnabled: true,
      archivedAt: null,
      sortOrder: 10,
      hasHistory: false,
      occupant: null,
    });
    const zone = (await layout()).blocks[0]!.zones[0]!;
    expect(zone.slots.map((s) => s.code).slice(-2)).toEqual(['T-10', 'T-11']);
    expect(zone.counts.total).toBe(11);
    expect(
      (await prisma.auditLog.findFirstOrThrow({ where: { action: 'SLOT_CREATED' } })).metadata,
    ).toMatchObject({ zone: 'ZONE-2W', priority: 11, status: 'AVAILABLE' });
  });

  it('puts the new slot into the existing allocation engine with no code change', async () => {
    await fillTwoWheelerZone();
    expect(
      errorCode(
        await guard.checkIn({
          vehicleNumber: 'KA01AB2000',
          vehicleType: 'TWO_WHEELER',
          ownerCategory: 'STUDENT',
          entryHour: 9,
        }),
      ),
    ).toBe('ZONE_FULL');

    await createSlot({ code: 'T-11' });
    expect((await guard.checkInOk('KA01AB2000')).session.slotCode).toBe('T-11');
    // The public counts follow too.
    const [twoWheeler] = await publicTotals();
    expect(twoWheeler).toMatchObject({ totalSlots: 11, availableSlots: 0 });
  });

  it('honours the allocation priority given at creation', async () => {
    await admin.post('/admin/slots', {
      zoneCode: 'ZONE-4W',
      vehicleType: 'FOUR_WHEELER',
      code: 'F-06',
      priority: 50,
    });
    expect((await guard.checkInOk('KA01CD0001', 'FOUR_WHEELER')).session.slotCode).toBe('F-06');
  });

  it('can start blocked (with a reason), and is then not allocated', async () => {
    const noReason = await createSlot({ code: 'T-11', status: 'BLOCKED' });
    expect(noReason.status).toBe(400);
    const res = await createSlot({ code: 'T-11', status: 'BLOCKED', blockedReason: 'Painting' });
    expect(res.body).toMatchObject({ status: 'BLOCKED', blockedReason: 'Painting' });
    await fillTwoWheelerZone().catch(() => undefined);
    expect(await slotStatus('T-11')).toBe('BLOCKED');
  });

  it.each([
    [{ code: 'T-01' }, 409, 'SLOT_CODE_TAKEN'],
    [{ zoneCode: 'ZONE-NOPE' }, 404, 'ZONE_NOT_FOUND'],
    [{ vehicleType: 'FOUR_WHEELER', code: 'F-09' }, 409, 'ZONE_TYPE_MISMATCH'],
  ])('refuses %j', async (override, status, code) => {
    const res = await createSlot({ code: 'T-11', ...override });
    expect(res.status).toBe(status);
    expect(errorCode(res)).toBe(code);
    expect(await prisma.parkingSlot.count()).toBe(15);
  });

  it.each([
    [{ code: 'F-11' }, 'body.code', 'validation.slotCodePrefix'], // F- slot in a two-wheeler request
    [{ code: 'T11' }, 'body.code', 'validation.invalidSlotCode'],
    [{ code: 'T-11', priority: 101 }, 'body.priority', 'validation.outOfRange'],
    [{ code: 'T-11', priority: -1 }, 'body.priority', 'validation.outOfRange'],
    [{ code: 'T-11', status: 'OCCUPIED' }, 'body.status', 'validation.selectOption'],
    [{ code: 'T-11', vehicleType: 'BUS' }, 'body.vehicleType', 'validation.selectOption'],
  ])('validates %j', async (override, path, message) => {
    const res = await createSlot(override);
    expect(res.status).toBe(400);
    expect((res.body as ApiErrorBody).error.details).toContainEqual({ path, message });
  });

  it('refuses a T- slot in a four-wheeler zone and an inactive zone', async () => {
    const res = await admin.post('/admin/slots', {
      zoneCode: 'ZONE-4W',
      vehicleType: 'FOUR_WHEELER',
      code: 'T-11',
    });
    expect(res.status).toBe(400); // prefix does not match the vehicle type
    await admin.patch('/admin/zones/ZONE-2W', { isActive: false });
    expect(errorCode(await createSlot({ code: 'T-11' }))).toBe('ZONE_INACTIVE');
  });
});

describe('editing a slot', () => {
  it('changes priority and layout order, which changes who is allocated next', async () => {
    const res = await admin.patch('/admin/slots/T-05', { priority: 30 });
    expect(res.status).toBe(200);
    expect((res.body as ManagedSlot).priority).toBe(30);
    expect((await guard.checkInOk('KA01AB0001')).session.slotCode).toBe('T-05');

    await admin.patch('/admin/slots/T-05', { sortOrder: 99 });
    expect((await findSlot('T-05'))?.sortOrder).toBe(99);
    const audit = await prisma.auditLog.findMany({
      where: { action: 'SLOT_UPDATED' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit[0]?.metadata).toMatchObject({ changes: { priority: { from: 0, to: 30 } } });
  });

  it('renames and moves a slot that has never been used', async () => {
    await createSlot({ code: 'T-11' });
    const renamed = await admin.patch('/admin/slots/T-11', { code: 't-12' });
    expect(renamed.status).toBe(200);
    expect((renamed.body as ManagedSlot).code).toBe('T-12');
    expect(await findSlot('T-11')).toBeUndefined();

    await admin.post('/admin/zones', {
      blockCode: 'BLOCK-2W',
      code: 'ZONE-2W-B',
      name: 'Two-Wheeler Overflow',
      vehicleType: 'TWO_WHEELER',
    });
    const moved = await admin.patch('/admin/slots/T-12', { zoneCode: 'ZONE-2W-B' });
    expect(moved.status).toBe(200);
    const zones = (await layout()).blocks[0]!.zones;
    expect(zones.find((z) => z.code === 'ZONE-2W-B')?.slots.map((s) => s.code)).toEqual(['T-12']);
  });

  it('keeps the slot ID and zone of a slot with parking history', async () => {
    await guard.checkInOk('KA01AB0001'); // T-01
    const done = (await guard.active()).body.sessions[0];
    await guard.checkOutOk(done.sessionNumber, 11);
    expect(errorCode(await admin.patch('/admin/slots/T-01', { code: 'T-99' }))).toBe(
      'SLOT_HAS_HISTORY',
    );
    expect(errorCode(await admin.patch('/admin/slots/T-01', { zoneCode: 'ZONE-4W' }))).toBe(
      'SLOT_HAS_HISTORY',
    );
    // Priority stays editable.
    expect((await admin.patch('/admin/slots/T-01', { priority: 5 })).status).toBe(200);
  });

  it('refuses to rename an occupied or held slot, a taken ID and a wrong prefix', async () => {
    await createSlot({ code: 'T-11' });
    await setSlotStatus('T-11', 'OCCUPIED');
    expect(errorCode(await admin.patch('/admin/slots/T-11', { code: 'T-12' }))).toBe('SLOT_IN_USE');
    await setSlotStatus('T-11', 'AVAILABLE');
    expect(errorCode(await admin.patch('/admin/slots/T-11', { code: 'T-01' }))).toBe(
      'SLOT_CODE_TAKEN',
    );
    expect(errorCode(await admin.patch('/admin/slots/T-11', { code: 'F-12' }))).toBe(
      'SLOT_CODE_MISMATCH',
    );
    expect(await findSlot('T-11')).toBeDefined();
  });

  it('edits the blocked reason only while the slot is blocked', async () => {
    expect(errorCode(await admin.patch('/admin/slots/T-02', { blockedReason: 'x' }))).toBe(
      'SLOT_NOT_BLOCKED',
    );
    await admin.post('/admin/slots/T-02/block', { reason: 'Painting' });
    const res = await admin.patch('/admin/slots/T-02', { blockedReason: 'Painting until Friday' });
    expect(res.body).toMatchObject({ status: 'BLOCKED', blockedReason: 'Painting until Friday' });
  });

  it('validates the patch and reports unknown slots', async () => {
    expect((await admin.patch('/admin/slots/T-01', {})).status).toBe(400);
    expect((await admin.patch('/admin/slots/T-01', { status: 'OCCUPIED' })).status).toBe(400);
    expect((await admin.patch('/admin/slots/T-01', { isEnabled: false })).status).toBe(400);
    expect(errorCode(await admin.patch('/admin/slots/T-99', { priority: 1 }))).toBe(
      'SLOT_NOT_FOUND',
    );
  });
});

describe('blocking, unblocking, enabling and disabling', () => {
  it('blocks and unblocks (and an occupied slot cannot be blocked)', async () => {
    await guard.checkInOk('KA01AB0001'); // T-01 occupied
    expect(errorCode(await admin.post('/admin/slots/T-01/block', { reason: 'x' }))).toBe(
      'SLOT_NOT_AVAILABLE',
    );
    expect((await admin.post('/admin/slots/T-02/block', { reason: 'Leak' })).status).toBe(200);
    expect(await slotStatus('T-02')).toBe('BLOCKED');
    expect((await admin.post('/admin/slots/T-02/unblock')).status).toBe(200);
    expect(await slotStatus('T-02')).toBe('AVAILABLE');
  });

  it('takes a slot out of service and back, without allocating or counting it meanwhile', async () => {
    const before = (await publicTotals())[0]!;
    const off = await admin.post('/admin/slots/T-01/disable');
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ code: 'T-01', isEnabled: false, status: 'AVAILABLE' });

    expect((await guard.checkInOk('KA01AB0001')).session.slotCode).toBe('T-02');
    const zone = (await layout()).blocks[0]!.zones[0]!;
    expect(zone.disabledSlots).toBe(1);
    expect(zone.counts.total).toBe(9);
    expect((await publicTotals())[0]).toMatchObject({ totalSlots: before.totalSlots - 1 });
    // The user-facing map hides it.
    const map = (await guard.map()).body.blocks[0].zones[0].slots.map(
      (s: { code: string }) => s.code,
    );
    expect(map).not.toContain('T-01');

    const on = await admin.post('/admin/slots/T-01/enable');
    expect(on.body).toMatchObject({ isEnabled: true });
    expect((await publicTotals())[0]).toMatchObject({ totalSlots: before.totalSlots });
    expect((await guard.checkInOk('KA01AB0002')).session.slotCode).toBe('T-01');

    const actions = (await prisma.auditLog.findMany({ where: { entityId: 'T-01' } })).map(
      (e) => e.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['SLOT_DISABLED', 'SLOT_ENABLED']));
  });

  it('is idempotent, and never disables an occupied or held slot', async () => {
    expect((await admin.post('/admin/slots/T-03/enable')).status).toBe(200); // already enabled
    await admin.post('/admin/slots/T-03/disable');
    expect((await admin.post('/admin/slots/T-03/disable')).status).toBe(200); // already disabled
    expect(await prisma.auditLog.count({ where: { action: 'SLOT_DISABLED' } })).toBe(1);

    await guard.checkInOk('KA01AB0001'); // T-01
    expect(errorCode(await admin.post('/admin/slots/T-01/disable'))).toBe('SLOT_IN_USE');

    const held = await createParkingUserWithVehicle(app);
    const offer = (
      await client(app, held.token).post('/portal/park-now/offers', { vehicleId: held.vehicle.id })
    ).body;
    expect(errorCode(await admin.post(`/admin/slots/${offer.allocation.slotCode}/disable`))).toBe(
      'SLOT_IN_USE',
    );
    expect(await slotStatus(offer.allocation.slotCode)).toBe('HELD');
  });

  it('keeps a disabled slot out of Park Now too', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    await admin.post('/admin/slots/T-01/disable');
    const res = await client(app, token).post('/portal/park-now/offers', { vehicleId: vehicle.id });
    expect((res.body as { allocation: { slotCode: string } }).allocation.slotCode).toBe('T-02');
  });
});

describe('archiving and deleting', () => {
  it('deletes an unused slot outright', async () => {
    await createSlot({ code: 'T-11' });
    const res = await admin.delete('/admin/slots/T-11');
    expect(res.status).toBe(200);
    expect(res.body as SlotDeletionResult).toEqual({ outcome: 'DELETED', code: 'T-11' });
    expect(await prisma.parkingSlot.count({ where: { code: 'T-11' } })).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { action: 'SLOT_DELETED', entityId: 'T-11' } }),
    ).toBe(1);
    // The ID can be used again.
    expect((await createSlot({ code: 'T-11' })).status).toBe(201);
  });

  it('archives a slot with history instead, keeping history, receipts and reports intact', async () => {
    const entry = await guard.checkInOk('KA22AB1234'); // T-01
    const done = await guard.checkOutOk(entry.session.sessionNumber, 13);

    const res = await admin.delete('/admin/slots/T-01');
    expect(res.body as SlotDeletionResult).toEqual({ outcome: 'ARCHIVED', code: 'T-01' });
    const stored = await prisma.parkingSlot.findUniqueOrThrow({ where: { code: 'T-01' } });
    expect(stored.archivedAt).not.toBeNull();

    // History and the receipt still show the slot.
    const receipt = await guard.receipt(done.receipt!.receiptNumber);
    expect(receipt.body.slotCode).toBe('T-01');
    const history = (await admin.get('/admin/history')).body as { items: { slotCode: string }[] };
    expect(history.items[0]?.slotCode).toBe('T-01');
    expect((await admin.get('/admin/integrity')).body.healthy).toBe(true);

    // Archived slots are not allocated, counted or shown — until asked for.
    expect((await guard.checkInOk('KA01AB0002')).session.slotCode).toBe('T-02');
    expect((await publicTotals())[0]).toMatchObject({ totalSlots: 9 });
    expect(await findSlot('T-01')).toBeUndefined();
    expect(await findSlot('T-01', true)).toMatchObject({
      archivedAt: expect.any(String),
      hasHistory: true,
    });
    expect(
      (await guard.map()).body.blocks[0].zones[0].slots.map((s: { code: string }) => s.code),
    ).not.toContain('T-01');
  });

  it('refuses to delete or archive an occupied or held slot', async () => {
    await guard.checkInOk('KA01AB0001'); // T-01 occupied
    expect(errorCode(await admin.delete('/admin/slots/T-01'))).toBe('SLOT_IN_USE');
    expect(errorCode(await admin.post('/admin/slots/T-01/archive'))).toBe('SLOT_IN_USE');
    expect(await slotStatus('T-01')).toBe('OCCUPIED');

    const user = await createParkingUserWithVehicle(app);
    const offer = (
      await client(app, user.token).post('/portal/park-now/offers', { vehicleId: user.vehicle.id })
    ).body;
    expect(errorCode(await admin.delete(`/admin/slots/${offer.allocation.slotCode}`))).toBe(
      'SLOT_IN_USE',
    );
    expect(await prisma.parkNowOffer.count({ where: { status: 'OFFERED' } })).toBe(1);
  });

  it('archives an unused slot on request and restores it', async () => {
    const archived = await admin.post('/admin/slots/T-10/archive');
    expect(archived.body).toEqual({ outcome: 'ARCHIVED', code: 'T-10' });
    expect(errorCode(await admin.post('/admin/slots/T-10/archive'))).toBe('SLOT_ARCHIVED');
    // An archived slot cannot be changed, and its ID stays reserved.
    for (const attempt of [
      () => admin.patch('/admin/slots/T-10', { priority: 3 }),
      () => admin.post('/admin/slots/T-10/block', { reason: 'x' }),
      () => admin.post('/admin/slots/T-10/enable'),
      () => admin.post('/admin/slots/T-10/disable'),
    ]) {
      expect(errorCode(await attempt())).toBe('SLOT_ARCHIVED');
    }
    const taken = await createSlot({ code: 'T-10' });
    expect(errorCode(taken)).toBe('SLOT_CODE_TAKEN');
    expect((taken.body as ApiErrorBody).error.message).toMatch(/archive/i);

    expect((await admin.post('/admin/slots/T-10/restore')).body).toMatchObject({
      code: 'T-10',
      archivedAt: null,
    });
    expect(errorCode(await admin.post('/admin/slots/T-10/restore'))).toBe('SLOT_NOT_ARCHIVED');
    expect(await findSlot('T-10')).toBeDefined();
    expect(errorCode(await admin.post('/admin/slots/T-99/restore'))).toBe('SLOT_NOT_FOUND');
  });

  it('never leaves an archived slot occupied or held (database guarantee)', async () => {
    await expect(
      prisma.parkingSlot.update({
        where: { code: 'T-01' },
        data: { archivedAt: new Date(), status: 'OCCUPIED' },
      }),
    ).rejects.toThrow();
  });
});

describe('the admin layout', () => {
  it('shows occupants, holds and history flags to the administrator', async () => {
    await guard.checkInOk('KA22AB1234'); // T-01
    const held = await createParkingUserWithVehicle(app, { vehicleNumber: 'KA01CD5678' });
    await client(app, held.token).post('/portal/park-now/offers', { vehicleId: held.vehicle.id });

    const occupied = await findSlot('T-01');
    expect(occupied).toMatchObject({
      status: 'OCCUPIED',
      hasHistory: true,
      occupant: { vehicleNumber: 'KA22AB1234', ownerCategory: 'STUDENT' },
    });
    const heldSlot = (await layout()).blocks[0]!.zones[0]!.slots.find((s) => s.status === 'HELD')!;
    expect(heldSlot.holdExpiresAt).not.toBeNull();
    expect(heldSlot.occupant).toBeNull();
    expect(await findSlot('T-09')).toMatchObject({ hasHistory: false, holdExpiresAt: null });
  });

  it('lists inactive blocks and zones with their state', async () => {
    await admin.patch('/admin/zones/ZONE-4W', { isActive: false });
    const blocks = (await layout()).blocks;
    expect(blocks.find((b) => b.code === 'BLOCK-4W')?.zones[0]).toMatchObject({
      isActive: false,
      vehicleType: 'FOUR_WHEELER',
    });
  });
});

describe('blocks and zones', () => {
  it('creates a block with real coordinates and a zone with slots that get allocated', async () => {
    const block = await admin.post('/admin/blocks', {
      code: 'block-lib',
      name: 'Library Parking',
      description: 'Behind the library',
      latitude: 15.8497,
      longitude: 74.4977,
    });
    expect(block.status).toBe(201);
    expect(block.body as ManagedBlock).toMatchObject({
      code: 'BLOCK-LIB',
      isActive: true,
      coordinates: { latitude: 15.8497, longitude: 74.4977 },
      zones: [],
    });

    const zone = await admin.post('/admin/zones', {
      blockCode: 'BLOCK-LIB',
      code: 'zone-lib-2w',
      name: 'Library Two-Wheelers',
      vehicleType: 'TWO_WHEELER',
    });
    expect(zone.status).toBe(201);
    expect((zone.body as ManagedBlock).zones[0]).toMatchObject({
      code: 'ZONE-LIB-2W',
      vehicleType: 'TWO_WHEELER',
    });

    await admin.post('/admin/slots', {
      zoneCode: 'ZONE-LIB-2W',
      vehicleType: 'TWO_WHEELER',
      code: 'T-21',
      priority: 100,
    });
    expect((await guard.checkInOk('KA01AB0001')).session).toMatchObject({
      slotCode: 'T-21',
      block: { code: 'BLOCK-LIB' },
    });
    const overview = (await client(app).get('/public/overview')).body as PublicOverviewResponse;
    expect(overview.locations.find((l) => l.code === 'BLOCK-LIB')?.coordinates).toEqual({
      latitude: 15.8497,
      longitude: 74.4977,
    });
  });

  it('never invents coordinates, and keeps them paired', async () => {
    const bare = await admin.post('/admin/blocks', { code: 'BLOCK-X', name: 'No GPS yet' });
    expect((bare.body as ManagedBlock).coordinates).toBeNull();
    expect(
      (await admin.post('/admin/blocks', { code: 'BLOCK-Y', name: 'Half', latitude: 15 })).status,
    ).toBe(400);
    expect(
      (
        await admin.post('/admin/blocks', {
          code: 'BLOCK-Z',
          name: 'Out',
          latitude: 95,
          longitude: 10,
        })
      ).status,
    ).toBe(400);
    const located = await admin.patch('/admin/blocks/BLOCK-2W/location', {
      latitude: 15.85,
      longitude: 74.5,
    });
    expect(located.status).toBe(200);
    expect((await layout()).blocks[0]?.coordinates).toEqual({ latitude: 15.85, longitude: 74.5 });
  });

  it('rejects duplicates and unknown parents', async () => {
    expect(errorCode(await admin.post('/admin/blocks', { code: 'BLOCK-2W', name: 'Dup' }))).toBe(
      'BLOCK_CODE_TAKEN',
    );
    expect(
      errorCode(
        await admin.post('/admin/zones', {
          blockCode: 'BLOCK-2W',
          code: 'ZONE-2W',
          name: 'Dup',
          vehicleType: 'TWO_WHEELER',
        }),
      ),
    ).toBe('ZONE_CODE_TAKEN');
    expect(
      errorCode(
        await admin.post('/admin/zones', {
          blockCode: 'BLOCK-NOPE',
          code: 'ZONE-N',
          name: 'N',
          vehicleType: 'TWO_WHEELER',
        }),
      ),
    ).toBe('BLOCK_NOT_FOUND');
    expect(errorCode(await admin.patch('/admin/blocks/BLOCK-NOPE', { name: 'x' }))).toBe(
      'BLOCK_NOT_FOUND',
    );
    expect(errorCode(await admin.patch('/admin/zones/ZONE-NOPE', { name: 'x' }))).toBe(
      'ZONE_NOT_FOUND',
    );
  });

  it('edits names and order, and deactivates an empty block so it is no longer allocated', async () => {
    const renamed = await admin.patch('/admin/blocks/BLOCK-4W', {
      name: 'Main Four-Wheeler Block',
      sortOrder: 5,
    });
    expect(renamed.body).toMatchObject({ name: 'Main Four-Wheeler Block', sortOrder: 5 });
    expect((await admin.patch('/admin/blocks/BLOCK-4W', { isActive: false })).status).toBe(200);
    expect(
      errorCode(
        await guard.checkIn({
          vehicleNumber: 'KA01CD0001',
          vehicleType: 'FOUR_WHEELER',
          ownerCategory: 'STUDENT',
          entryHour: 9,
        }),
      ),
    ).toBe('ZONE_NOT_CONFIGURED');
    expect((await admin.patch('/admin/blocks/BLOCK-4W', { isActive: true })).status).toBe(200);
    expect((await guard.checkInOk('KA01CD0001', 'FOUR_WHEELER')).session.slotCode).toBe('F-01');
  });

  it('refuses to retype a zone that has slots, whatever is parked', async () => {
    await guard.checkInOk('KA01AB0001');
    expect(
      errorCode(await admin.patch('/admin/zones/ZONE-2W', { vehicleType: 'FOUR_WHEELER' })),
    ).toBe('ZONE_IN_USE');
    expect(await slotStatus('T-01')).toBe('OCCUPIED');
  });

  it('lets an empty zone change its vehicle type', async () => {
    await admin.post('/admin/zones', {
      blockCode: 'BLOCK-2W',
      code: 'ZONE-NEW',
      name: 'Spare',
      vehicleType: 'TWO_WHEELER',
    });
    const res = await admin.patch('/admin/zones/ZONE-NEW', {
      vehicleType: 'FOUR_WHEELER',
      name: 'Spare 4W',
    });
    expect(res.status).toBe(200);
    expect((res.body as ManagedBlock).zones.find((z) => z.code === 'ZONE-NEW')).toMatchObject({
      vehicleType: 'FOUR_WHEELER',
      name: 'Spare 4W',
    });
  });
});

describe('who may manage the inventory', () => {
  const calls: [method: 'post' | 'patch' | 'delete', path: string, body?: object][] = [
    ['post', '/admin/slots', { zoneCode: 'ZONE-2W', vehicleType: 'TWO_WHEELER', code: 'T-11' }],
    ['patch', '/admin/slots/T-01', { priority: 1 }],
    ['delete', '/admin/slots/T-01'],
    ['post', '/admin/slots/T-01/archive'],
    ['post', '/admin/slots/T-01/restore'],
    ['post', '/admin/slots/T-01/enable'],
    ['post', '/admin/slots/T-01/disable'],
    ['post', '/admin/slots/T-01/block', { reason: 'x' }],
    ['post', '/admin/slots/T-01/unblock'],
    ['patch', '/admin/slots/T-01/priority', { priority: 1 }],
    ['post', '/admin/blocks', { code: 'BLOCK-N', name: 'N' }],
    ['patch', '/admin/blocks/BLOCK-2W', { name: 'N' }],
    ['patch', '/admin/blocks/BLOCK-2W/location', { latitude: 1, longitude: 1 }],
    [
      'post',
      '/admin/zones',
      { blockCode: 'BLOCK-2W', code: 'Z', name: 'Z', vehicleType: 'TWO_WHEELER' },
    ],
    ['patch', '/admin/zones/ZONE-2W', { name: 'N' }],
  ];

  it.each(calls)('%s %s is for administrators only', async (method, path, body = {}) => {
    const student = await createParkingUser();
    for (const token of [guardToken, student.token]) {
      const res = await client(app, token)[method](path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect((await request(app)[method](`/api/v1${path}`).send(body)).status).toBe(401);
    // Nothing changed.
    expect(await prisma.parkingSlot.count()).toBe(15);
    expect(await slotStatus('T-01')).toBe('AVAILABLE');
  });
});
