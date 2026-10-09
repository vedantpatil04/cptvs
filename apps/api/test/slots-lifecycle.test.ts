import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type {
  ManagedLayout,
  ParkingMapResponse,
  ParkNowOffer,
  PublicOverviewResponse,
  ShiftTemplateView,
} from '@cpvts/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { slotHoldRepository } from '../src/modules/parking/slot-hold.repository.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn, slotStatus } from './parking-helpers.js';
import { testEnv } from './test-env.js';
import { adminAccount, client, createParkingUserWithVehicle, errorCode } from './user-helpers.js';

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

const twoWheelerTotal = async () =>
  (
    (await request(app).get('/api/v1/public/overview')).body as PublicOverviewResponse
  ).availability.find((entry) => entry.vehicleType === 'TWO_WHEELER');

describe('disabling a block or zone: parked vehicles carry on, nothing new is allocated', () => {
  it('keeps the session running, keeps the vehicle on the map and lets it check out', async () => {
    const parked = await guard.checkInOk('KA22AB1234');
    expect(parked.session.slotCode).toBe('T-01');

    const disabled = await admin.patch('/admin/blocks/BLOCK-2W', { isActive: false });
    expect(disabled.status).toBe(200);

    // The session goes on: it is found, and the vehicle is still on the live map in its block.
    expect(
      ((await guard.track('KA22AB1234')).body as { session: { status: string } }).session.status,
    ).toBe('ACTIVE');
    const map = (await guard.map()).body as ParkingMapResponse;
    const block = map.blocks.find((b) => b.code === 'BLOCK-2W');
    expect(block).toMatchObject({ isActive: false });
    expect(block?.zones[0]).toMatchObject({ code: 'ZONE-2W', isActive: false });
    expect(block?.zones[0]?.slots.map((s) => s.code)).toEqual(['T-01']); // only the vehicle still parked
    expect(block?.zones[0]?.slots[0]?.occupant?.vehicleNumber).toBe('KA22AB1234');
    expect(map.blocks.find((b) => b.code === 'BLOCK-4W')).toMatchObject({ isActive: true });

    // New allocations cannot target the disabled block, and it no longer counts as capacity.
    const refused = await guard.checkIn({
      vehicleNumber: 'KA01CD0002',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'STUDENT',
      entryHour: 9,
    });
    expect(errorCode(refused)).toBe('ZONE_NOT_CONFIGURED');
    expect(await twoWheelerTotal()).toMatchObject({ totalSlots: 0, availableSlots: 0 });

    // The vehicle checks out normally and the slot comes back (but stays out of the pool).
    const done = await guard.checkOutOk(parked.session.sessionNumber, 12);
    expect(done.receipt?.totalPaise).toBe(1000); // student 2W 09→12: 2 free hours, then 1 × ₹10
    expect(await slotStatus('T-01')).toBe('AVAILABLE');
    expect(((await guard.map()).body as ParkingMapResponse).blocks.map((b) => b.code)).toEqual([
      'BLOCK-4W',
    ]);

    // Enabled again, it is allocated again (T-01 was used today, so the engine spreads use to T-02).
    expect((await admin.patch('/admin/blocks/BLOCK-2W', { isActive: true })).status).toBe(200);
    expect((await guard.checkInOk('KA01CD0002')).session.slotCode).toBe('T-02');
  });

  it('works for a single zone in the same way', async () => {
    const parked = await guard.checkInOk('KA22AB1234');
    expect((await admin.patch('/admin/zones/ZONE-2W', { isActive: false })).status).toBe(200);
    const map = (await guard.map()).body as ParkingMapResponse;
    expect(map.blocks.find((b) => b.code === 'BLOCK-2W')?.zones[0]).toMatchObject({
      isActive: false,
    });
    expect(
      errorCode(
        await guard.checkIn({
          vehicleNumber: 'KA01CD0002',
          vehicleType: 'TWO_WHEELER',
          ownerCategory: 'STUDENT',
          entryHour: 9,
        }),
      ),
    ).toBe('ZONE_NOT_CONFIGURED');
    expect((await guard.checkOutOk(parked.session.sessionNumber, 9)).receipt).toBeTruthy();
    const layout = (await admin.get('/admin/layout')).body as ManagedLayout;
    expect(layout.blocks.find((b) => b.code === 'BLOCK-2W')?.zones[0]).toMatchObject({
      isActive: false,
    });
  });

  it('cancels a Park Now offer waiting in the block and frees its slot at once', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const offer = (await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }))
      .body as ParkNowOffer;
    expect(await slotStatus(offer.allocation.slotCode)).toBe('HELD');

    await admin.patch('/admin/blocks/BLOCK-2W', { isActive: false });
    expect(await slotStatus(offer.allocation.slotCode)).toBe('AVAILABLE');
    expect(await prisma.parkNowOffer.count({ where: { status: 'OFFERED' } })).toBe(0);
    const confirm = await portal.post('/portal/park-now/confirm', { offerId: offer.offerId });
    expect(errorCode(confirm)).toBe('OFFER_NOT_FOUND');
    expect(await prisma.parkingSession.count()).toBe(0);
  });

  it('leaves a Park Now session that is already running alone', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const offer = (await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }))
      .body as ParkNowOffer;
    await portal.post('/portal/park-now/confirm', { offerId: offer.offerId });

    await admin.patch('/admin/blocks/BLOCK-2W', { isActive: false });
    const active = (await portal.get('/portal/sessions/active')).body as {
      sessions: { status: string }[];
    };
    expect(active.sessions.map((s) => s.status)).toEqual(['ACTIVE']);
    // …and the portal layout still marks the user's own slot.
    const layout = (await portal.get('/portal/layout')).body as { mySlots: string[] };
    expect(layout.mySlots).toEqual([offer.allocation.slotCode]);
  });
});

describe('a slot hold never keeps inventory occupied for good', () => {
  it('reads an expired hold as free everywhere, not only at the next allocation', async () => {
    await prisma.parkingSlot.update({
      where: { code: 'T-01' },
      data: { status: 'HELD', holdToken: 'abandoned', holdExpiresAt: new Date(Date.now() - 1_000) },
    });
    // The public counts do not treat the lapsed hold as taken.
    expect(await twoWheelerTotal()).toMatchObject({ totalSlots: 10, availableSlots: 10 });
    expect(await slotStatus('T-01')).toBe('AVAILABLE');
  });

  it('is cleared by the background sweep, which also lapses the offer behind it', async () => {
    const { token, vehicle } = await createParkingUserWithVehicle(app);
    const portal = client(app, token);
    const offer = (await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }))
      .body as ParkNowOffer;

    // The hold is short-lived and server controlled: no longer than the configured Park Now lifetime.
    const slot = await prisma.parkingSlot.findUniqueOrThrow({
      where: { code: offer.allocation.slotCode },
    });
    expect(slot.status).toBe('HELD');
    const lifetimeMs = slot.holdExpiresAt!.getTime() - Date.now();
    expect(lifetimeMs).toBeGreaterThan(0);
    expect(lifetimeMs).toBeLessThanOrEqual(config.parking.parkNowHoldMs);
    expect(new Date(offer.expiresAt).getTime()).toBe(slot.holdExpiresAt!.getTime());

    // Time passes (the user walked away).
    const past = new Date(Date.now() - 1_000);
    await prisma.parkingSlot.update({ where: { id: slot.id }, data: { holdExpiresAt: past } });
    await prisma.parkNowOffer.update({ where: { id: offer.offerId }, data: { expiresAt: past } });

    expect(await slotHoldRepository.releaseExpired()).toBe(1);
    expect(await slotStatus(slot.code)).toBe('AVAILABLE');
    expect(
      (await prisma.parkNowOffer.findUniqueOrThrow({ where: { id: offer.offerId } })).status,
    ).toBe('EXPIRED');
    expect(
      errorCode(await portal.post('/portal/park-now/confirm', { offerId: offer.offerId })),
    ).toBe('OFFER_EXPIRED');
    // Sweeping again finds nothing.
    expect(await slotHoldRepository.releaseExpired()).toBe(0);
  });
});

describe('the starting inventory (npm run db:seed)', () => {
  const apiDir = fileURLToPath(new URL('..', import.meta.url));
  const seed = () =>
    execFileSync(process.execPath, ['--import', 'tsx/esm', 'src/scripts/seed.ts'], {
      cwd: apiDir,
      env: {
        ...process.env,
        ...testEnv,
        SEED_ADMIN_USERNAME: 'admin',
        SEED_ADMIN_PASSWORD: 'a-long-seed-password',
        SEED_STAFF_USERNAME: 'security',
        SEED_STAFF_PASSWORD: 'another-long-seed-password',
      },
      encoding: 'utf8',
    });

  it('creates T-01…T-10 and F-01…F-05, the starter shift templates and the official fees', async () => {
    await resetDatabase();
    const first = seed();
    expect(first).toContain('Parking layout: created 2 blocks with 15 slots');

    const slots = await prisma.parkingSlot.findMany({
      orderBy: { code: 'asc' },
      select: {
        code: true,
        status: true,
        isEnabled: true,
        zone: { select: { vehicleType: true } },
      },
    });
    const codes = slots.map((slot) => slot.code);
    expect(codes).toEqual([
      ...Array.from({ length: 5 }, (_, i) => `F-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 10 }, (_, i) => `T-${String(i + 1).padStart(2, '0')}`),
    ]);
    expect(slots.every((slot) => slot.status === 'AVAILABLE' && slot.isEnabled)).toBe(true);
    expect(slots.filter((s) => s.zone.vehicleType === 'FOUR_WHEELER')).toHaveLength(5);
    // Coordinates are never invented.
    expect(await prisma.parkingBlock.count({ where: { latitude: { not: null } } })).toBe(0);

    const admin = client(app, (await signIn('ADMIN', 'x')).token);
    const templates = (await admin.get('/admin/shift-templates')).body as ShiftTemplateView[];
    expect(templates.map((t) => [t.name, t.startTime, t.endTime])).toEqual([
      ['Night', '00:00', '08:00'],
      ['Morning', '08:00', '16:00'],
      ['Evening', '16:00', '00:00'],
    ]);
    expect(await prisma.setting.count({ where: { key: 'parking.feeSchedule' } })).toBe(1);
    expect(
      await prisma.user.count({
        where: {
          role: { in: ['ADMIN', 'SECURITY_STAFF'] },
          username: { in: ['admin', 'security'] },
        },
      }),
    ).toBe(2);

    // Running it again changes nothing.
    const again = seed();
    expect(again).toContain('Shift templates: already configured, left unchanged');
    expect(again).toContain('blocks already configured, left unchanged');
    expect(await prisma.parkingSlot.count()).toBe(15);
    expect(await prisma.shiftTemplate.count()).toBe(3);
  }, 120_000);
});
