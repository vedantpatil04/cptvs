import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase } from '../src/db/prisma.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn } from './parking-helpers.js';

const app = createApp(config);
const SESSION = 'CPVTS-P-00000000';
const PAYMENT = '00000000-0000-4000-8000-000000000000';

const PROTECTED: [method: 'get' | 'post', path: string][] = [
  ['post', '/api/v1/parking/check-ins'],
  ['get', '/api/v1/parking/map'],
  ['get', '/api/v1/parking/sessions/active'],
  ['get', `/api/v1/parking/sessions/${SESSION}`],
  ['get', '/api/v1/parking/tracking?q=KA22AB1234'],
  ['post', '/api/v1/parking/checkouts/quote'],
  ['post', '/api/v1/parking/payments'],
  ['post', `/api/v1/parking/payments/${PAYMENT}/process`],
  ['post', `/api/v1/parking/payments/${PAYMENT}/cancel`],
  ['get', '/api/v1/parking/receipts/CPVTS-R-2026-00000000'],
  ['get', '/api/v1/dashboard/summary'],
];

const STAFF_ONLY: [method: 'get' | 'post', path: string][] = [
  ['post', '/api/v1/parking/check-ins'],
  ['post', '/api/v1/parking/checkouts/quote'],
  ['post', '/api/v1/parking/payments'],
  ['post', `/api/v1/parking/payments/${PAYMENT}/process`],
  ['post', `/api/v1/parking/payments/${PAYMENT}/cancel`],
];

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
});

afterAll(disconnectDatabase);

describe('access control', () => {
  it.each(PROTECTED)('%s %s requires sign-in', async (method, path) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
  });

  it.each(STAFF_ONLY)('%s %s is for Security Staff only', async (method, path) => {
    const { token } = await signIn('ADMIN', 'boss');
    const res = await request(app)[method](path).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(403);
  });

  it('lets administrators read the map, tracking and active sessions', async () => {
    const staff = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
    await staff.checkInOk('KA22AB1234');
    const admin = parkingApi(app, (await signIn('ADMIN', 'boss')).token);
    expect((await admin.map()).status).toBe(200);
    expect((await admin.track('KA22AB1234')).status).toBe(200);
    expect((await admin.active()).status).toBe(200);
  });
});

describe('public privacy boundary', () => {
  it('public endpoints never reveal vehicles, slots, sessions, payments or revenue', async () => {
    const staff = parkingApi(app, (await signIn('SECURITY_STAFF', 'guard')).token);
    const parked = await staff.checkInOk('KA22AB1234');
    const left = await staff.checkInOk('KA01AB5678', 'TWO_WHEELER', 'VISITOR', 9);
    const { payment } = await staff.checkOutOk(left.session.sessionNumber, 12);

    const overview = await request(app).get('/api/v1/public/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.availability).toContainEqual({
      vehicleType: 'TWO_WHEELER',
      totalSlots: 10,
      availableSlots: 9,
    });
    const text = JSON.stringify(overview.body);
    for (const secret of [
      'KA22AB1234',
      'KA01AB5678',
      parked.session.slotCode,
      parked.session.sessionNumber,
      parked.session.entryReference!,
      payment.transactionId,
      '6000',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('there is no public route to sessions, tracking or the map', async () => {
    for (const path of [
      '/api/v1/public/sessions',
      '/api/v1/public/tracking',
      '/api/v1/public/map',
    ]) {
      expect((await request(app).get(path)).status).toBe(404);
    }
  });
});
