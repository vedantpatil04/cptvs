import type {
  DeleteSlotResponse,
  ManagedLayout,
  ManagedSlot,
  NextSlotCodeResponse,
  PublicOverviewResponse,
  ReceiptView,
} from '@cpvts/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn } from './parking-helpers.js';
import {
  admin,
  API,
  app,
  bearer,
  createParkingUser,
  errorCode,
  portal,
  visitor,
} from './user-helpers.js';

let adminToken: string;
let guardToken: string;
let a: ReturnType<typeof admin>;
let guard: ReturnType<typeof parkingApi>;

const newSlot = (extra: Record<string, unknown> = {}) => ({
  zoneCode: 'ZONE-2W',
  vehicleType: 'TWO_WHEELER',
  code: 't-11',
  ...extra,
});

const findSlot = async (code: string) =>
  ((await a.get('/layout')).body as ManagedLayout).blocks
    .flatMap((block) => block.zones.flatMap((zone) => zone.slots))
    .find((slot) => slot.code === code);

const overview = async () =>
  (await request(app).get(`${API}/public/overview`)).body as PublicOverviewResponse;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  adminToken = (await signIn('ADMIN', 'boss')).token;
  guardToken = (await signIn('SECURITY_STAFF', 'guard')).token;
  a = admin(adminToken);
  guard = parkingApi(app, guardToken);
});

afterAll(disconnectDatabase);

describe('adding slots', () => {
  it('creates a slot in an existing zone and it joins allocation without any redeploy', async () => {
    const created = await a.post('/slots', newSlot({ priority: 50, label: 'Near gate' }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      code: 'T-11',
      status: 'AVAILABLE',
      priority: 50,
      label: 'Near gate',
      isActive: true,
      sessionCount: 0,
      occupant: null,
    });
    expect((await overview()).availability[0]).toMatchObject({
      totalSlots: 11,
      availableSlots: 11,
    });

    // Priority dominates the ranking, so the new slot is the engine's next choice.
    expect((await guard.checkInOk('KA01AB0001')).session.slotCode).toBe('T-11');
  });

  it('keeps the configured minimum and lets administrators extend each zone', async () => {
    expect((await a.post('/slots', newSlot({ code: 'T-11' }))).status).toBe(201);
    expect(
      (
        await a.post(
          '/slots',
          newSlot({ zoneCode: 'ZONE-4W', vehicleType: 'FOUR_WHEELER', code: 'F-06' }),
        )
      ).status,
    ).toBe(201);
    const layout = (await a.get('/layout')).body as ManagedLayout;
    const counts = layout.blocks.map((block) => block.zones[0]!.slots.length);
    expect(counts).toEqual([11, 6]);
  });

  it('rejects duplicate slot IDs, including archived ones', async () => {
    expect((await a.post('/slots', newSlot())).status).toBe(201);
    expect(errorCode((await a.post('/slots', newSlot())).body)).toBe('SLOT_CODE_TAKEN');
    // T-01 exists from the baseline layout.
    expect(errorCode((await a.post('/slots', newSlot({ code: 'T-01' }))).body)).toBe(
      'SLOT_CODE_TAKEN',
    );
  });

  it.each([
    ['a slot ID without the vehicle type letter', { code: 'F-11' }, 'VALIDATION_ERROR'],
    ['a malformed slot ID', { code: 'T11' }, 'VALIDATION_ERROR'],
    ['a one-digit slot ID', { code: 'T-1' }, 'VALIDATION_ERROR'],
    ['a priority above 100', { priority: 101 }, 'VALIDATION_ERROR'],
    ['a blocked slot without a reason', { status: 'BLOCKED' }, 'VALIDATION_ERROR'],
    ['an unknown status', { status: 'OCCUPIED' }, 'VALIDATION_ERROR'],
  ])('rejects %s', async (_name, extra, code) => {
    const res = await a.post('/slots', newSlot(extra));
    expect(res.status).toBe(400);
    expect(errorCode(res.body)).toBe(code);
  });

  it('rejects a vehicle type that does not match the zone, and unknown zones', async () => {
    // A four-wheeler slot cannot be put into the two-wheeler zone.
    const wrongZone = await a.post(
      '/slots',
      newSlot({ vehicleType: 'FOUR_WHEELER', code: 'F-06' }),
    );
    expect(errorCode(wrongZone.body)).toBe('SLOT_VEHICLE_MISMATCH');
    expect(errorCode((await a.post('/slots', newSlot({ zoneCode: 'NOPE' }))).body)).toBe(
      'ZONE_NOT_FOUND',
    );
    expect(await prisma.parkingSlot.count()).toBe(15);
  });

  it('creates blocked and disabled slots as requested', async () => {
    const blocked = await a.post(
      '/slots',
      newSlot({ status: 'BLOCKED', blockedReason: 'Wet floor' }),
    );
    expect(blocked.body).toMatchObject({
      code: 'T-11',
      status: 'BLOCKED',
      blockedReason: 'Wet floor',
    });
    const disabled = await a.post('/slots', newSlot({ code: 'T-12', status: 'DISABLED' }));
    expect(disabled.body).toMatchObject({ code: 'T-12', status: 'AVAILABLE', isActive: false });
    // The blocked slot is counted but not free; the disabled one is out of service entirely.
    expect((await overview()).availability[0]).toMatchObject({
      totalSlots: 11,
      availableSlots: 10,
    });
  });

  it('suggests the next unused slot ID for a zone', async () => {
    expect(((await a.get('/zones/ZONE-2W/next-slot-code')).body as NextSlotCodeResponse).code).toBe(
      'T-11',
    );
    expect(((await a.get('/zones/ZONE-4W/next-slot-code')).body as NextSlotCodeResponse).code).toBe(
      'F-06',
    );
    await a.post('/slots', newSlot());
    expect(((await a.get('/zones/ZONE-2W/next-slot-code')).body as NextSlotCodeResponse).code).toBe(
      'T-12',
    );
    expect((await a.get('/zones/NOPE/next-slot-code')).status).toBe(404);
  });

  it('writes an audit entry for every slot change', async () => {
    await a.post('/slots', newSlot());
    await a.patch('/slots/T-11', { priority: 5 });
    await a.post('/slots/T-11/disable');
    await a.post('/slots/T-11/enable');
    await a.delete('/slots/T-11');
    const actions = (await prisma.auditLog.findMany({ where: { entityId: 'T-11' } }))
      .map((entry) => entry.action)
      .sort();
    expect(actions).toEqual([
      'SLOT_CREATED',
      'SLOT_DELETED',
      'SLOT_DISABLED',
      'SLOT_ENABLED',
      'SLOT_PRIORITY_CHANGED',
    ]);
  });
});

describe('editing slots', () => {
  it('edits priority and label but never the slot ID', async () => {
    const res = await a.patch('/slots/T-03', { priority: 7, label: '  Covered  ' });
    expect(res.body).toMatchObject({ code: 'T-03', priority: 7, label: 'Covered' });
    expect(((await a.patch('/slots/T-03', { label: '' })).body as ManagedSlot).label).toBeNull();

    expect((await a.patch('/slots/T-03', { code: 'T-99' })).status).toBe(400);
    expect((await a.patch('/slots/T-03', {})).status).toBe(400);
    expect((await a.patch('/slots/T-03', { priority: -1 })).status).toBe(400);
    expect((await a.patch('/slots/T-77', { priority: 1 })).status).toBe(404);
  });

  it('edits the reason of a blocked slot, and only of a blocked slot', async () => {
    expect(errorCode((await a.patch('/slots/T-03', { blockedReason: 'x' })).body)).toBe(
      'SLOT_NOT_BLOCKED',
    );
    await a.post('/slots/T-03/block', { reason: 'Maintenance' });
    const res = await a.patch('/slots/T-03', { blockedReason: 'Resurfacing' });
    expect(res.body).toMatchObject({ status: 'BLOCKED', blockedReason: 'Resurfacing' });
  });

  it('shows the parked vehicle and session of an occupied slot', async () => {
    const parked = await guard.checkInOk('KA01AB0001', 'TWO_WHEELER', 'VISITOR', 9);
    const slot = await findSlot(parked.session.slotCode);
    expect(slot).toMatchObject({
      status: 'OCCUPIED',
      sessionCount: 1,
      occupant: {
        vehicleNumber: 'KA01AB0001',
        sessionNumber: parked.session.sessionNumber,
        ownerCategory: 'VISITOR',
        entryHour: 9,
      },
    });
  });
});

describe('enabling and disabling slots', () => {
  it('takes a slot out of service: never allocated, hidden from the public counts and the live map', async () => {
    const res = await a.post('/slots/T-01/disable');
    expect(res.body).toMatchObject({ code: 'T-01', isActive: false });

    expect((await overview()).availability[0]).toMatchObject({ totalSlots: 9, availableSlots: 9 });
    expect((await guard.checkInOk('KA01AB0001')).session.slotCode).toBe('T-02');
    const map = (await guard.map()).body as ManagedLayout;
    expect(JSON.stringify(map)).not.toContain('"T-01"');

    // The administrator still sees it, flagged.
    expect(await findSlot('T-01')).toMatchObject({ isActive: false, status: 'AVAILABLE' });

    await a.post('/slots/T-01/enable');
    expect((await overview()).availability[0]).toMatchObject({ totalSlots: 10 });
    expect((await guard.checkInOk('KA01AB0002')).session.slotCode).toBe('T-01');
  });

  it('refuses to disable a slot that is in use, and to block a disabled one', async () => {
    const parked = await guard.checkInOk('KA01AB0001');
    expect(errorCode((await a.post(`/slots/${parked.session.slotCode}/disable`)).body)).toBe(
      'SLOT_IN_USE',
    );
    await a.post('/slots/T-05/disable');
    expect(errorCode((await a.post('/slots/T-05/block', { reason: 'x' })).body)).toBe(
      'SLOT_DISABLED',
    );
  });

  it('is idempotent', async () => {
    expect((await a.post('/slots/T-01/enable')).status).toBe(200);
    await a.post('/slots/T-01/disable');
    expect((await a.post('/slots/T-01/disable')).status).toBe(200);
  });
});

describe('deleting slots', () => {
  it('never deletes a slot with a vehicle in it', async () => {
    const parked = await guard.checkInOk('KA01AB0001');
    const res = await a.delete(`/slots/${parked.session.slotCode}`);
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe('SLOT_IN_USE');
    expect(await findSlot(parked.session.slotCode)).toMatchObject({ status: 'OCCUPIED' });
  });

  it('never deletes a slot that is being assigned', async () => {
    await prisma.parkingSlot.update({
      where: { code: 'T-04' },
      data: {
        status: 'HELD',
        holdToken: 'x'.repeat(24),
        holdExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(errorCode((await a.delete('/slots/T-04')).body)).toBe('SLOT_IN_USE');
  });

  it('removes a slot that was never used, and its ID can be created again', async () => {
    await a.post('/slots', newSlot());
    const res = await a.delete('/slots/T-11');
    expect(res.body as DeleteSlotResponse).toEqual({ code: 'T-11', outcome: 'DELETED' });
    expect(await prisma.parkingSlot.count({ where: { code: 'T-11' } })).toBe(0);
    expect((await a.post('/slots', newSlot())).status).toBe(201);
  });

  it('archives a slot with parking history instead, so history and receipts stay intact', async () => {
    const parked = await guard.checkInOk('KA01AB0001', 'TWO_WHEELER', 'VISITOR', 9);
    const slotCode = parked.session.slotCode;
    const done = await guard.checkOutOk(parked.session.sessionNumber, 11);

    const res = await a.delete(`/slots/${slotCode}`);
    expect(res.body as DeleteSlotResponse).toEqual({ code: slotCode, outcome: 'ARCHIVED' });

    // Hidden from every live view ...
    expect(await findSlot(slotCode)).toBeUndefined();
    expect((await overview()).availability[0]).toMatchObject({ totalSlots: 9 });
    expect((await guard.checkInOk('KA01AB0002')).session.slotCode).not.toBe(slotCode);
    // ... but the row, the session and the receipt still refer to it.
    expect(await prisma.parkingSlot.count({ where: { code: slotCode } })).toBe(1);
    const receipt = (await guard.receipt(done.receipt!.receiptNumber)).body as ReceiptView;
    expect(receipt.slotCode).toBe(slotCode);
    const history = await a.get(`/history?vehicleNumber=KA01AB0001`);
    expect(history.body.items[0]).toMatchObject({ slotCode, status: 'COMPLETED' });

    // The ID stays reserved and the archived slot can no longer be managed.
    expect(errorCode((await a.post('/slots', newSlot({ code: slotCode }))).body)).toBe(
      'SLOT_CODE_TAKEN',
    );
    expect((await a.patch(`/slots/${slotCode}`, { priority: 3 })).status).toBe(404);
    expect((await a.delete(`/slots/${slotCode}`)).status).toBe(404);
  });

  it('can delete a blocked slot that is not in use', async () => {
    await a.post('/slots/T-02/block', { reason: 'Broken' });
    expect(((await a.delete('/slots/T-02')).body as DeleteSlotResponse).outcome).toBe('DELETED');
  });
});

describe('parking blocks and zones', () => {
  it('renames a block and a zone, and edits the block description', async () => {
    const block = await a.patch('/blocks/BLOCK-2W', {
      name: 'North Bike Bay',
      description: 'By the library',
    });
    expect(block.body).toMatchObject({
      name: 'North Bike Bay',
      description: 'By the library',
      isActive: true,
    });
    const zone = await a.patch('/zones/ZONE-2W', { name: 'Bike Bay' });
    expect(zone.body).toMatchObject({
      code: 'ZONE-2W',
      name: 'Bike Bay',
      vehicleType: 'TWO_WHEELER',
    });
    expect((await a.patch('/zones/ZONE-2W', { vehicleType: 'FOUR_WHEELER' })).status).toBe(400);
    expect((await a.patch('/blocks/NOPE', { name: 'x' })).status).toBe(404);
    expect((await a.patch('/blocks/BLOCK-2W', {})).status).toBe(400);
  });

  it('takes an empty zone out of service and back, hiding it from drivers while it is out', async () => {
    const off = await a.patch('/zones/ZONE-2W', { isActive: false });
    expect(off.body).toMatchObject({ isActive: false });
    expect((await overview()).availability[0]).toMatchObject({ totalSlots: 0 });
    const refused = await guard.checkIn({
      vehicleNumber: 'KA01AB0001',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 9,
    });
    expect(errorCode(refused.body)).toBe('ZONE_NOT_CONFIGURED');

    // The administrator still sees it, flagged.
    const layout = (await a.get('/layout')).body as ManagedLayout;
    expect(layout.blocks[0]!.zones[0]).toMatchObject({ isActive: false });

    await a.patch('/zones/ZONE-2W', { isActive: true });
    expect((await guard.checkInOk('KA01AB0001')).session.slotCode).toBe('T-01');
  });

  it('refuses to take a zone or block out of service while vehicles are parked in it', async () => {
    await guard.checkInOk('KA01AB0001');
    expect(errorCode((await a.patch('/zones/ZONE-2W', { isActive: false })).body)).toBe(
      'ZONE_IN_USE',
    );
    expect(errorCode((await a.patch('/blocks/BLOCK-2W', { isActive: false })).body)).toBe(
      'BLOCK_IN_USE',
    );
    // A different, empty block can still be switched off.
    expect((await a.patch('/blocks/BLOCK-4W', { isActive: false })).status).toBe(200);
  });
});

describe('who may manage slots', () => {
  const ENDPOINTS: [method: 'get' | 'post' | 'patch' | 'delete', path: string][] = [
    ['get', '/layout'],
    ['post', '/slots'],
    ['get', '/zones/ZONE-2W/next-slot-code'],
    ['patch', '/slots/T-01'],
    ['post', '/slots/T-01/block'],
    ['post', '/slots/T-01/unblock'],
    ['post', '/slots/T-01/enable'],
    ['post', '/slots/T-01/disable'],
    ['delete', '/slots/T-01'],
    ['patch', '/blocks/BLOCK-2W'],
    ['patch', '/zones/ZONE-2W'],
  ];

  it.each(ENDPOINTS)('%s /admin%s is for administrators only', async (method, path) => {
    const student = await createParkingUser('STUDENT');
    const staff = await createParkingUser('STAFF');
    const send = (token?: string) => {
      const req = request(app)[method](`${API}/admin${path}`);
      return (token ? req.set(bearer(token)) : req).send({});
    };

    expect((await send()).status).toBe(401);
    for (const token of [guardToken, student.token, staff.token]) {
      expect((await send(token)).status, `${method} ${path}`).toBe(403);
    }
    // A visitor token is not an account token at all.
    const parked = await guard.checkInOk('KA09ZZ0009', 'TWO_WHEELER', 'VISITOR', 9);
    const access = await request(app)
      .post(`${API}/visitor/access`)
      .send({ vehicleNumber: 'KA09ZZ0009', sessionNumber: parked.session.sessionNumber });
    expect((await send(access.body.accessToken)).status).toBe(401);
    void visitor;
    void portal;
  });

  it('leaves the slot configuration untouched after refused attempts', async () => {
    const before = await prisma.parkingSlot.count();
    await request(app).post(`${API}/admin/slots`).set(bearer(guardToken)).send(newSlot());
    await request(app).delete(`${API}/admin/slots/T-01`).set(bearer(guardToken));
    expect(await prisma.parkingSlot.count()).toBe(before);
    expect(await prisma.parkingSlot.count({ where: { code: 'T-11' } })).toBe(0);
  });
});
