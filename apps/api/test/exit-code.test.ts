import {
  entryQrPayload,
  type ExitCodeResponse,
  type ParkNowConfirmation,
  type ParkNowOffer,
  type ScanCheckoutResponse,
} from '@cpvts/shared';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { createExitCodeRateLimiter } from '../src/middleware/rate-limit.js';
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

const codeAt = (token: string, code: string) =>
  request(app)
    .post('/api/v1/parking/checkouts/code')
    .set({ Authorization: `Bearer ${token}` })
    .send({ code });

/** A student parks through Park Now and gets an ACTIVE session; returns the owner's client. */
const parkedStudent = async (
  options: { institutionalId?: string; vehicleNumber?: string } = {},
) => {
  const { token, vehicle } = await createParkingUserWithVehicle(app, options);
  const portal = client(app, token);
  const offer = (await portal.post('/portal/park-now/offers', { vehicleId: vehicle.id }))
    .body as ParkNowOffer;
  const confirmed = (await portal.post('/portal/park-now/confirm', { offerId: offer.offerId }))
    .body as ParkNowConfirmation;
  return { portal, session: confirmed.session, token };
};

const issue = async (portal: ReturnType<typeof client>, sessionNumber: string) => {
  const res = await portal.post(`/portal/sessions/${sessionNumber}/exit-code`);
  expect(res.status).toBe(201);
  return res.body as ExitCodeResponse;
};

describe('the 6-digit exit code', () => {
  it('lets the owner issue a code that the gate resolves to the verified active session', async () => {
    const { portal, session } = await parkedStudent();
    const issued = await issue(portal, session.sessionNumber);

    expect(issued.code).toMatch(/^[0-9]{6}$/);
    expect(issued.ttlSeconds).toBe(config.parking.exitCodeTtlSeconds);
    expect(new Date(issued.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const res = await codeAt(guardToken, issued.code);
    expect(res.status).toBe(200);
    const body = res.body as ScanCheckoutResponse;
    expect(body).toMatchObject({
      matchedBy: 'EXIT_CODE',
      checks: { sessionActive: true, vehicleMatchesSession: true, slotMatchesSession: true },
      session: { sessionNumber: session.sessionNumber, status: 'ACTIVE' },
    });
    expect(
      await prisma.auditLog.count({
        where: { action: 'CHECKOUT_CODE_ENTERED', entityId: session.sessionNumber },
      }),
    ).toBe(1);

    // Entering the code at the exit gate stops the timer, like a scan; entering it again does not move it.
    const captured = await prisma.parkingSession.findUniqueOrThrow({
      where: { sessionNumber: session.sessionNumber },
    });
    expect(captured.exitCapturedAt).not.toBeNull();
    expect(body.exitAt).toBe(captured.exitCapturedAt?.toISOString());
  });

  it('stores only a keyed hash, never the code', async () => {
    const { portal, session } = await parkedStudent();
    const { code } = await issue(portal, session.sessionNumber);
    const rows = await prisma.exitCode.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(code);
    const audits = await prisma.auditLog.findMany({ where: { action: 'EXIT_CODE_ISSUED' } });
    expect(JSON.stringify(audits)).not.toContain(code);
  });

  it('never completes anything: the session stays active and the slot occupied', async () => {
    const { portal, session } = await parkedStudent();
    const { code } = await issue(portal, session.sessionNumber);
    await codeAt(guardToken, code);
    const after = await prisma.parkingSession.findUniqueOrThrow({
      where: { sessionNumber: session.sessionNumber },
      include: { slot: true, payments: true },
    });
    expect(after.status).toBe('ACTIVE');
    expect(after.slot.status).toBe('OCCUPIED');
    expect(after.payments).toHaveLength(0);
  });

  it('refuses wrong, malformed and expired codes, and audits the refusal', async () => {
    const { portal, session } = await parkedStudent();
    const { code } = await issue(portal, session.sessionNumber);
    const wrong = code === '000000' ? '000001' : '000000';

    const unknown = await codeAt(guardToken, wrong);
    expect(unknown.status).toBe(400);
    expect(errorCode(unknown)).toBe('INVALID_EXIT_CODE');
    expect(await prisma.auditLog.count({ where: { action: 'INTEGRITY_REJECTED' } })).toBe(1);

    for (const bad of ['12345', '1234567', 'abcdef', '12 3456', '']) {
      const res = await codeAt(guardToken, bad);
      expect(res.status, bad).toBe(400);
      expect(errorCode(res), bad).toBe('VALIDATION_ERROR');
    }

    await prisma.exitCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await codeAt(guardToken, code);
    expect(expired.status).toBe(400);
    expect(errorCode(expired)).toBe('INVALID_EXIT_CODE');
  });

  it('replaces the earlier code when a new one is issued', async () => {
    const { portal, session } = await parkedStudent();
    const first = await issue(portal, session.sessionNumber);
    const second = await issue(portal, session.sessionNumber);
    expect(await prisma.exitCode.count()).toBe(1);
    if (first.code !== second.code) {
      expect(errorCode(await codeAt(guardToken, first.code))).toBe('INVALID_EXIT_CODE');
    }
    expect((await codeAt(guardToken, second.code)).status).toBe(200);
  });

  it('is invalidated when the checkout is finalized, exactly once', async () => {
    const { portal, session } = await parkedStudent();
    const { code } = await issue(portal, session.sessionNumber);
    expect((await codeAt(guardToken, code)).status).toBe(200);

    const done = await guard.checkOutOk(session.sessionNumber, session.entryHour + 3);
    expect(done.payment.status).toBe('PAID');
    expect(await prisma.exitCode.count()).toBe(0);

    const reused = await codeAt(guardToken, code);
    expect(reused.status).toBe(400);
    expect(errorCode(reused)).toBe('INVALID_EXIT_CODE');

    // A second checkout of the finished session is refused and the receipt stays single.
    const again = await guard.quote({
      sessionNumber: session.sessionNumber,
      exitHour: session.entryHour + 3,
    });
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('SESSION_NOT_ACTIVE');
    expect(await prisma.receipt.count()).toBe(1);
  });

  it("is issued only for the caller's own active session", async () => {
    const { session } = await parkedStudent();
    const stranger = await createParkingUser({ institutionalId: '2BT22CS002' });
    const res = await client(app, stranger.token).post(
      `/portal/sessions/${session.sessionNumber}/exit-code`,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.exitCode.count()).toBe(0);

    const { portal, session: finished } = await parkedStudent({
      institutionalId: '2BT22CS003',
      vehicleNumber: 'KA22AB5678',
    });
    await guard.checkOutOk(finished.sessionNumber, finished.entryHour + 1);
    const late = await portal.post(`/portal/sessions/${finished.sessionNumber}/exit-code`);
    expect(late.status).toBe(409);
    expect(errorCode(late)).toBe('SESSION_NOT_ACTIVE');
  });

  it('can be issued to a visitor for their session', async () => {
    const parked = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 9);
    const access = await client(app).post('/visitor/access', {
      vehicleNumber: 'KA22AB1234',
      sessionNumber: parked.session.sessionNumber,
    });
    const visitorToken = (access.body as { accessToken: string }).accessToken;
    const res = await client(app, visitorToken).post('/visitor/exit-code');
    expect(res.status).toBe(201);
    const { code } = res.body as ExitCodeResponse;
    const resolved = await codeAt(guardToken, code);
    expect(resolved.status).toBe(200);
    expect((resolved.body as ScanCheckoutResponse).session.sessionNumber).toBe(
      parked.session.sessionNumber,
    );
    // The QR is a separate credential and still works.
    expect((await guard.scan(entryQrPayload(parked.session.entryReference!))).status).toBe(200);
  });

  it('is available to Security Staff and administrators only', async () => {
    const { portal, session } = await parkedStudent();
    const { code } = await issue(portal, session.sessionNumber);
    const student = await createParkingUser({ institutionalId: '2BT22CS002' });
    expect((await request(app).post('/api/v1/parking/checkouts/code').send({ code })).status).toBe(
      401,
    );
    expect((await codeAt(student.token, code)).status).toBe(403);
    const admin = await signIn('ADMIN', 'boss');
    expect((await codeAt(admin.token, code)).status).toBe(200);
  });
});

describe('exit code rate limit', () => {
  it('stops guessing once an operator has spent their failed attempts', async () => {
    const limited = express();
    limited.use(express.json());
    limited.use(
      (req, _res, next) => {
        req.auth = { user: { id: 'operator-1' } } as unknown as typeof req.auth;
        next();
      },
      createExitCodeRateLimiter({ windowMs: 60_000, limit: 3 }),
    );
    limited.post('/code', (req, res) => {
      res.status((req.body as { ok: boolean }).ok ? 200 : 400).json({});
    });

    // A correct entry is not counted against the budget.
    expect((await request(limited).post('/code').send({ ok: true })).status).toBe(200);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await request(limited).post('/code').send({ ok: false })).status).toBe(400);
    }
    expect((await request(limited).post('/code').send({ ok: false })).status).toBe(429);
  });
});
