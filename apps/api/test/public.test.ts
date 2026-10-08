import type { PublicOverviewResponse } from '@cpvts/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { createUser, resetDatabase } from './helpers.js';

const app = createApp(config);

const getOverview = async () => {
  const res = await request(app).get('/api/v1/public/overview');
  expect(res.status).toBe(200);
  return { res, body: res.body as PublicOverviewResponse };
};

/** Creates an active block with one zone and the given slot statuses. */
const createBlock = async (
  code: string,
  vehicleType: 'TWO_WHEELER' | 'FOUR_WHEELER',
  statuses: ('AVAILABLE' | 'OCCUPIED' | 'BLOCKED')[],
  options: { isActive?: boolean; coordinates?: [number, number] } = {},
) =>
  prisma.parkingBlock.create({
    data: {
      code,
      name: `${code} block`,
      isActive: options.isActive ?? true,
      latitude: options.coordinates?.[0],
      longitude: options.coordinates?.[1],
      zones: {
        create: {
          code: `${code}-Z`,
          name: `${code} zone`,
          vehicleType,
          slots: {
            create: statuses.map((status, index) => ({ code: `${code}-${index + 1}`, status })),
          },
        },
      },
    },
    include: { zones: { include: { slots: true } } },
  });

beforeEach(resetDatabase);
afterAll(disconnectDatabase);

describe('GET /api/v1/public/overview', () => {
  it('is available without authentication and reports an unconfigured system honestly', async () => {
    const { body } = await getOverview();
    expect(body.availability).toEqual([
      { vehicleType: 'TWO_WHEELER', totalSlots: 0, availableSlots: 0 },
      { vehicleType: 'FOUR_WHEELER', totalSlots: 0, availableSlots: 0 },
    ]);
    expect(body.locations).toEqual([]);
    expect(body.feeSchedule).toBeNull();
  });

  it('counts available slots per vehicle type across active blocks only', async () => {
    await createBlock('TW', 'TWO_WHEELER', ['AVAILABLE', 'AVAILABLE', 'OCCUPIED', 'BLOCKED']);
    await createBlock('FW', 'FOUR_WHEELER', ['AVAILABLE', 'OCCUPIED']);
    await createBlock('OLD', 'TWO_WHEELER', ['AVAILABLE', 'AVAILABLE'], { isActive: false });

    const { body } = await getOverview();
    expect(body.availability).toEqual([
      { vehicleType: 'TWO_WHEELER', totalSlots: 4, availableSlots: 2 },
      { vehicleType: 'FOUR_WHEELER', totalSlots: 2, availableSlots: 1 },
    ]);
    expect(body.locations.map((location) => location.code)).toEqual(['FW', 'TW']);
  });

  it('publishes block coordinates only when configured', async () => {
    await createBlock('TW', 'TWO_WHEELER', ['AVAILABLE'], { coordinates: [15.8497, 74.4977] });
    await createBlock('FW', 'FOUR_WHEELER', ['AVAILABLE']);

    const { body } = await getOverview();
    const byCode = Object.fromEntries(body.locations.map((location) => [location.code, location]));
    expect(byCode.TW).toMatchObject({
      vehicleTypes: ['TWO_WHEELER'],
      coordinates: { latitude: 15.8497, longitude: 74.4977 },
    });
    expect(byCode.FW?.coordinates).toBeNull();
  });

  it('publishes a valid fee schedule and withholds an invalid one', async () => {
    const schedule = {
      currency: 'INR',
      rules: {
        STAFF: { TWO_WHEELER: { type: 'FREE' }, FOUR_WHEELER: { type: 'FREE' } },
        STUDENT: {
          TWO_WHEELER: { type: 'FREE_HOURS_THEN_HOURLY', freeHours: 2, hourlyRatePaise: 1000 },
          FOUR_WHEELER: { type: 'FREE_HOURS_THEN_HOURLY', freeHours: 2, hourlyRatePaise: 2000 },
        },
        VISITOR: {
          TWO_WHEELER: { type: 'HOURLY', hourlyRatePaise: 2000 },
          FOUR_WHEELER: { type: 'HOURLY', hourlyRatePaise: 4000 },
        },
      },
    };
    await prisma.setting.create({ data: { key: 'parking.feeSchedule', value: schedule } });
    expect((await getOverview()).body.feeSchedule).toEqual(schedule);

    await prisma.setting.update({
      where: { key: 'parking.feeSchedule' },
      data: { value: { currency: 'INR', rules: {} } },
    });
    expect((await getOverview()).body.feeSchedule).toBeNull();
  });

  it('never exposes vehicles, slot assignments, sessions or payments', async () => {
    const staff = await createUser('SECURITY_STAFF', 'guard');
    const block = await createBlock('TW', 'TWO_WHEELER', ['OCCUPIED', 'AVAILABLE']);
    const slot = block.zones[0]!.slots.find((s) => s.status === 'OCCUPIED')!;
    const vehicle = await prisma.vehicle.create({
      data: { vehicleNumber: 'KA22AB1234', vehicleType: 'TWO_WHEELER' },
    });
    const session = await prisma.parkingSession.create({
      data: {
        sessionNumber: 'CPVTS-P-SECRET1',
        entryReference: 'entry-ref-secret',
        vehicleId: vehicle.id,
        slotId: slot.id,
        vehicleType: 'TWO_WHEELER',
        ownerCategory: 'STUDENT',
        entryHour: 9,
        entryAt: new Date(),
        checkedInById: staff.id,
      },
    });
    await prisma.payment.create({
      data: {
        sessionId: session.id,
        transactionId: 'TXN-SECRET01',
        method: 'UPI',
        amountPaise: 2000,
        exitHour: 13,
      },
    });

    const { res } = await getOverview();
    const serialized = JSON.stringify(res.body);
    for (const secret of [
      'KA22AB1234',
      slot.code,
      'CPVTS-P-SECRET1',
      'entry-ref-secret',
      'TXN-SECRET01',
      staff.username,
      vehicle.id,
      session.id,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('is cacheable briefly by browsers and proxies', async () => {
    const { res } = await getOverview();
    expect(res.headers['cache-control']).toBe('public, max-age=15');
  });
});
