import type {
  CheckInResponse,
  CheckoutQuote,
  CreatePaymentResponse,
  DashboardSummary,
  NotificationsResponse,
  Page,
  ParkingSessionView,
  ParkingUserProfileView,
  ParkProposal,
  PortalOverview,
  ProcessPaymentResponse,
  ReceiptView,
  RegisteredVehicle,
  SessionTimelineResponse,
  VisitorAccessResponse,
} from '@cpvts/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { resetDatabase } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn } from './parking-helpers.js';
import {
  addVehicle,
  admin,
  API,
  app,
  bearer,
  createParkingUser,
  errorCode,
  portal,
  setCampusHour,
  visitor,
} from './user-helpers.js';

let adminToken: string;
let guardToken: string;
let guard: ReturnType<typeof parkingApi>;

type User = Awaited<ReturnType<typeof createParkingUser>>;

/** A verified user with one registered vehicle. */
const driver = async (
  category: 'STUDENT' | 'STAFF',
  vehicleNumber: string,
  vehicleType = 'TWO_WHEELER',
): Promise<User & { vehicle: RegisteredVehicle }> => {
  const user = await createParkingUser(category);
  return { ...user, vehicle: await addVehicle(user.token, vehicleNumber, vehicleType) };
};

const propose = (user: User, vehicleId: string) =>
  portal(user.token).post('/parking/proposals', { vehicleId });

const confirm = (user: User, vehicleId: string, proposal: ParkProposal) =>
  portal(user.token).post('/parking/confirm', {
    vehicleId,
    slotCode: proposal.slotCode,
    proposalToken: proposal.proposalToken,
  });

/** Park now, both steps. */
const parkNow = async (user: User, vehicleId: string): Promise<CheckInResponse> => {
  const proposed = await propose(user, vehicleId);
  expect(proposed.status).toBe(201);
  const confirmed = await confirm(user, vehicleId, proposed.body as ParkProposal);
  expect(confirmed.status).toBe(201);
  return confirmed.body as CheckInResponse;
};

const slotRow = (code: string) => prisma.parkingSlot.findUniqueOrThrow({ where: { code } });

beforeEach(async () => {
  setCampusHour(9);
  await resetDatabase();
  await seedLayout();
  await seedFees();
  adminToken = (await signIn('ADMIN', 'boss')).token;
  guardToken = (await signIn('SECURITY_STAFF', 'guard')).token;
  guard = parkingApi(app, guardToken);
});

afterEach(() => vi.useRealTimers());
afterAll(disconnectDatabase);

describe('Park now: the engine proposes, the student confirms', () => {
  it('holds the engine’s best slot for the user and records nothing as parked yet', async () => {
    const student = await driver('STUDENT', 'KA22AB1234');
    const res = await propose(student, student.vehicle.id);
    const proposal = res.body as ParkProposal;

    expect(res.status).toBe(201);
    expect(proposal).toMatchObject({
      slotCode: 'T-01',
      blockName: 'Two-Wheeler Parking Block',
      zoneName: 'Two-Wheeler Zone',
      ownerCategory: 'STUDENT',
      entryHour: 9,
      availability: { availableSlots: 10, totalSlots: 10 },
      vehicle: { id: student.vehicle.id, vehicleNumber: 'KA22AB1234', vehicleType: 'TWO_WHEELER' },
      allocation: {
        slotCode: 'T-01',
        candidatesConsidered: 10,
        checks: [
          'CORRECT_ZONE',
          'AVAILABLE',
          'NOT_BLOCKED',
          'BEST_SCORE',
          'FINAL_AVAILABILITY_VERIFIED',
        ],
      },
    });
    expect(proposal.proposalToken.length).toBeGreaterThan(16);
    expect(Date.parse(proposal.expiresAt)).toBeGreaterThan(Date.now());

    expect(await slotRow('T-01')).toMatchObject({ status: 'HELD', holdUserId: student.user.id });
    expect(await prisma.parkingSession.count()).toBe(0);
    expect((await portal(student.token).get('/sessions/current')).body).toEqual([]);
  });

  it('confirming creates the ACTIVE session in the account’s category, with no receipt yet', async () => {
    const student = await driver('STUDENT', 'KA22AB1234');
    const parked = await parkNow(student, student.vehicle.id);

    expect(parked.categorySource).toBe('ACCOUNT');
    expect(parked.session).toMatchObject({
      status: 'ACTIVE',
      vehicleNumber: 'KA22AB1234',
      ownerCategory: 'STUDENT',
      slotCode: 'T-01',
      entryHour: 9,
      receiptNumber: null,
    });
    expect(parked.session.entryReference).toEqual(expect.any(String));
    expect(parked.allocation).toMatchObject({ slotCode: 'T-01' });

    expect(await slotRow('T-01')).toMatchObject({
      status: 'OCCUPIED',
      holdToken: null,
      holdUserId: null,
    });
    const session = await prisma.parkingSession.findFirstOrThrow({});
    expect(session.checkedInById).toBe(student.user.id);
    expect(await prisma.receipt.count()).toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'VEHICLE_CHECKED_IN' },
    });
    expect(audit).toMatchObject({ actorId: student.user.id });
    expect(audit.metadata).toMatchObject({ source: 'SELF_SERVICE', categorySource: 'ACCOUNT' });
    expect(await prisma.auditLog.count({ where: { action: 'SLOT_ASSIGNED' } })).toBe(1);

    // The same record is what everyone else sees.
    const current = (await portal(student.token).get('/sessions/current'))
      .body as ParkingSessionView[];
    expect(current.map((entry) => entry.sessionNumber)).toEqual([parked.session.sessionNumber]);
    expect(
      ((await guard.track('KA22AB1234')).body as { session: ParkingSessionView }).session.slotCode,
    ).toBe('T-01');
  });

  it('bills Campus Staff in the Staff category', async () => {
    const staff = await driver('STAFF', 'KA03EF9012', 'FOUR_WHEELER');
    const parked = await parkNow(staff, staff.vehicle.id);
    expect(parked.session).toMatchObject({
      ownerCategory: 'STAFF',
      slotCode: 'F-01',
      vehicleType: 'FOUR_WHEELER',
    });
  });

  it('lets the user accept or abandon the proposal, never choose a slot', async () => {
    const student = await driver('STUDENT', 'KA22AB1234');
    const other = await driver('STUDENT', 'KA22CD5678');
    const proposal = (await propose(student, student.vehicle.id)).body as ParkProposal;

    // Another slot that happens to be free cannot be claimed with this token.
    const wrongSlot = await portal(student.token).post('/parking/confirm', {
      vehicleId: student.vehicle.id,
      slotCode: 'T-05',
      proposalToken: proposal.proposalToken,
    });
    expect(errorCode(wrongSlot.body)).toBe('PARK_PROPOSAL_EXPIRED');
    expect((await slotRow('T-05')).status).toBe('AVAILABLE');

    // Neither can a guessed token, nor someone else's confirmation of this slot.
    const guessed = await portal(student.token).post('/parking/confirm', {
      vehicleId: student.vehicle.id,
      slotCode: proposal.slotCode,
      proposalToken: 'g'.repeat(32),
    });
    expect(errorCode(guessed.body)).toBe('PARK_PROPOSAL_EXPIRED');
    const stolen = await confirm(other, other.vehicle.id, proposal);
    expect(errorCode(stolen.body)).toBe('PARK_PROPOSAL_EXPIRED');
    expect(await slotRow(proposal.slotCode)).toMatchObject({ status: 'HELD' });
    expect(await prisma.parkingSession.count()).toBe(0);

    // The rightful holder still can.
    expect((await confirm(student, student.vehicle.id, proposal)).status).toBe(201);
  });

  it('gives a user one proposal at a time: starting again releases the earlier slot', async () => {
    const student = await user2Vehicles();
    const first = (await propose(student, student.a.id)).body as ParkProposal;
    const second = (await propose(student, student.b.id)).body as ParkProposal;

    expect(second.proposalToken).not.toBe(first.proposalToken);
    expect(await prisma.parkingSlot.count({ where: { status: 'HELD' } })).toBe(1);
    expect(errorCode((await confirm(student, student.a.id, first)).body)).toBe(
      'PARK_PROPOSAL_EXPIRED',
    );
    expect((await confirm(student, student.b.id, second)).status).toBe(201);
  });

  it('serves two students at the same time with two different slots', async () => {
    const one = await driver('STUDENT', 'KA22AB1111');
    const two = await driver('STUDENT', 'KA22AB2222');
    const [first, second] = await Promise.all([
      propose(one, one.vehicle.id),
      propose(two, two.vehicle.id),
    ]);
    const slots = [first, second].map((res) => (res.body as ParkProposal).slotCode).sort();
    expect(slots).toEqual(['T-01', 'T-02']);
  });

  it('only parks the user’s own vehicles', async () => {
    const student = await driver('STUDENT', 'KA22AB1234');
    const other = await driver('STUDENT', 'KA22CD5678');
    expect(errorCode((await propose(student, other.vehicle.id)).body)).toBe('VEHICLE_NOT_FOUND');
    const proposal = (await propose(student, student.vehicle.id)).body as ParkProposal;
    expect(errorCode((await confirm(student, other.vehicle.id, proposal)).body)).toBe(
      'VEHICLE_NOT_FOUND',
    );
    expect(await prisma.parkingSession.count()).toBe(0);
  });

  it('needs an approved account and a parking-user token', async () => {
    const pending = await createParkingUser('STUDENT', 'PENDING');
    const body = { vehicleId: '00000000-0000-4000-8000-000000000000' };
    for (const path of ['/parking/proposals', '/parking/confirm', '/parking/cancel']) {
      const res = await portal(pending.token).post(path, {
        ...body,
        slotCode: 'T-01',
        proposalToken: 'x'.repeat(20),
      });
      expect(res.status, path).toBe(403);
      expect(errorCode(res.body), path).toBe('VERIFICATION_REQUIRED');
      expect((await request(app).post(`${API}/portal${path}`).send(body)).status).toBe(401);
      for (const token of [adminToken, guardToken]) {
        expect(
          (await request(app).post(`${API}/portal${path}`).set(bearer(token)).send(body)).status,
        ).toBe(403);
      }
    }
  });

  it('refuses a vehicle that is already parked, before and after parking', async () => {
    const student = await driver('STUDENT', 'KA22AB1234');
    await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 8);
    expect(errorCode((await propose(student, student.vehicle.id)).body)).toBe(
      'DUPLICATE_ACTIVE_VEHICLE',
    );

    const other = await driver('STUDENT', 'KA22CD5678');
    await parkNow(other, other.vehicle.id);
    expect(errorCode((await propose(other, other.vehicle.id)).body)).toBe(
      'DUPLICATE_ACTIVE_VEHICLE',
    );
  });

  it('lets a proposal lapse: the slot is given back and the old token is useless', async () => {
    const student = await driver('STUDENT', 'KA22AB1234');
    const proposal = (await propose(student, student.vehicle.id)).body as ParkProposal;
    await prisma.parkingSlot.update({
      where: { code: proposal.slotCode },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });

    expect(errorCode((await confirm(student, student.vehicle.id, proposal)).body)).toBe(
      'PARK_PROPOSAL_EXPIRED',
    );
    expect(await prisma.parkingSession.count()).toBe(0);
    // The next proposal reclaims the lapsed hold and offers the same, best, slot again.
    const again = (await propose(student, student.vehicle.id)).body as ParkProposal;
    expect(again.slotCode).toBe(proposal.slotCode);
    expect(again.proposalToken).not.toBe(proposal.proposalToken);
  });

  it('releases the slot when the student backs out, and only for the holder', async () => {
    const student = await driver('STUDENT', 'KA22AB1234');
    const other = await driver('STUDENT', 'KA22CD5678');
    const proposal = (await propose(student, student.vehicle.id)).body as ParkProposal;
    const cancel = (user: User, token = proposal.proposalToken) =>
      portal(user.token).post('/parking/cancel', {
        slotCode: proposal.slotCode,
        proposalToken: token,
      });

    expect((await cancel(other)).status).toBe(204);
    expect((await cancel(student, 'g'.repeat(32))).status).toBe(204);
    expect((await slotRow(proposal.slotCode)).status).toBe('HELD');

    expect((await cancel(student)).status).toBe(204);
    expect((await slotRow(proposal.slotCode)).status).toBe('AVAILABLE');
  });

  it('reports a full zone instead of proposing anything', async () => {
    const student = await driver('STUDENT', 'KA22AB1234');
    await prisma.parkingSlot.updateMany({
      where: { zone: { vehicleType: 'TWO_WHEELER' } },
      data: { status: 'BLOCKED', blockedReason: 'Closed' },
    });
    expect(errorCode((await propose(student, student.vehicle.id)).body)).toBe('ZONE_FULL');
    expect(await prisma.parkingSlot.count({ where: { status: 'HELD' } })).toBe(0);
  });

  it('offers a slot an administrator just added, and never a disabled one', async () => {
    const student = await driver('STUDENT', 'KA22AB1234');
    await prisma.parkingSlot.updateMany({
      where: { zone: { vehicleType: 'TWO_WHEELER' } },
      data: { status: 'BLOCKED', blockedReason: 'Closed' },
    });
    const a = admin(adminToken);
    await a.post('/slots', {
      zoneCode: 'ZONE-2W',
      vehicleType: 'TWO_WHEELER',
      code: 'T-11',
      status: 'DISABLED',
    });
    expect(errorCode((await propose(student, student.vehicle.id)).body)).toBe('ZONE_FULL');

    await a.post('/slots/T-11/enable');
    expect(((await propose(student, student.vehicle.id)).body as ParkProposal).slotCode).toBe(
      'T-11',
    );
  });
});

/** One user with two registered two-wheelers. */
const user2Vehicles = async () => {
  const user = await createParkingUser('STUDENT');
  return {
    ...user,
    a: await addVehicle(user.token, 'KA22AB1111'),
    b: await addVehicle(user.token, 'KA22AB2222'),
  };
};

describe('self-service checkout and payment', () => {
  /** Parks at 09:xx, then moves the clock to 13:xx. */
  const parkedUntilThirteen = async (category: 'STUDENT' | 'STAFF' = 'STUDENT') => {
    const user = await driver(category, 'KA22AB1234');
    const parked = await parkNow(user, user.vehicle.id);
    setCampusHour(13);
    return { user, session: parked.session };
  };

  const checkout = (user: User, sessionNumber: string, body: object = {}) =>
    portal(user.token).post(`/sessions/${sessionNumber}/checkout`, body);
  const pay = (user: User, sessionNumber: string, method: string, body: object = {}) =>
    portal(user.token).post(`/sessions/${sessionNumber}/payments`, { method, ...body });

  it('quotes the stay at the server’s hour with the fee engine’s price', async () => {
    const { user, session } = await parkedUntilThirteen();
    // The client cannot pick the exit hour.
    const res = await checkout(user, session.sessionNumber, { exitHour: 23 });
    const quote = res.body as CheckoutQuote;
    expect(res.status).toBe(200);
    expect(quote).toMatchObject({ exitHour: 13, durationHours: 4 });
    expect(quote.fee.totalPaise).toBe(2000); // Student two-wheeler: 2 free hours, then 2 × ₹10
    expect(quote.fee.lines).toEqual([
      { kind: 'FREE', hours: 2 },
      { kind: 'CHARGED', hours: 2, ratePaise: 1000, amountPaise: 2000 },
    ]);
  });

  it('completes parking: payment, receipt, finalized session, released slot, notification', async () => {
    const { user, session } = await parkedUntilThirteen();
    const created = await pay(user, session.sessionNumber, 'UPI', { exitHour: 23 });
    const { payment } = created.body as CreatePaymentResponse;
    expect(created.status).toBe(201);
    expect(payment).toMatchObject({
      status: 'PENDING',
      amountPaise: 2000,
      exitHour: 13,
      isSimulated: true,
    });

    // The unfinished payment shows up on the home overview.
    const pending = (await portal(user.token).get('/overview')).body as PortalOverview;
    expect(pending.pendingCheckouts).toEqual([
      {
        sessionNumber: session.sessionNumber,
        paymentId: payment.id,
        amountPaise: 2000,
        exitHour: 13,
      },
    ]);

    const paid = await portal(user.token).post(`/payments/${payment.id}/process`);
    const { receipt } = paid.body as ProcessPaymentResponse;
    expect(paid.status).toBe(200);
    expect(receipt).toMatchObject({
      sessionNumber: session.sessionNumber,
      totalPaise: 2000,
      durationHours: 4,
      exitHour: 13,
      payment: { status: 'PAID', method: 'UPI' },
    });

    const row = await prisma.parkingSession.findFirstOrThrow({
      where: { sessionNumber: session.sessionNumber },
    });
    expect(row).toMatchObject({
      status: 'COMPLETED',
      feeAmountPaise: 2000,
      checkedOutById: user.user.id,
    });
    expect((await slotRow(session.slotCode)).status).toBe('AVAILABLE');

    // The same finalized record feeds history, receipts, the dashboard and the notice.
    const history = (await portal(user.token).get('/history')).body as Page<{
      feePaise: number;
      status: string;
    }>;
    expect(history.items[0]).toMatchObject({ feePaise: 2000, status: 'COMPLETED' });
    expect(
      ((await portal(user.token).get(`/receipts/${receipt!.receiptNumber}`)).body as ReceiptView)
        .totalPaise,
    ).toBe(2000);
    expect(((await guard.receipt(receipt!.receiptNumber)).body as ReceiptView).totalPaise).toBe(
      2000,
    );
    const fees = ((await guard.summary()).body as DashboardSummary).todayFeesCollectedPaise;
    expect(fees).toBeNull(); // security staff never see revenue
    const notices = (await portal(user.token).get('/notifications')).body as NotificationsResponse;
    expect(notices.items[0]).toMatchObject({
      type: 'RECEIPT_GENERATED',
      data: { receiptNumber: receipt!.receiptNumber, amountPaise: 2000 },
    });

    // Paying twice is refused.
    expect(errorCode((await portal(user.token).post(`/payments/${payment.id}/process`)).body)).toBe(
      'PAYMENT_NOT_PENDING',
    );
    expect(errorCode((await checkout(user, session.sessionNumber)).body)).toBe(
      'SESSION_NOT_ACTIVE',
    );
  });

  it('shows the finished parking on the home overview', async () => {
    const { user, session } = await parkedUntilThirteen();
    const { payment } = (await pay(user, session.sessionNumber, 'CARD'))
      .body as CreatePaymentResponse;
    await portal(user.token).post(`/payments/${payment.id}/process`);
    const home = (await portal(user.token).get('/overview')).body as PortalOverview;
    expect(home.activeSessions).toEqual([]);
    expect(home.pendingCheckouts).toEqual([]);
    expect(home.lastCompleted).toMatchObject({
      sessionNumber: session.sessionNumber,
      feePaise: 2000,
    });
    expect(home.vehicles[0]!.activeSession).toBeNull();
  });

  it('charges nothing to Campus Staff and uses the no-charge method', async () => {
    const { user, session } = await parkedUntilThirteen('STAFF');
    expect(
      ((await checkout(user, session.sessionNumber)).body as CheckoutQuote).fee.totalPaise,
    ).toBe(0);
    expect(errorCode((await pay(user, session.sessionNumber, 'UPI')).body)).toBe(
      'INVALID_PAYMENT_METHOD',
    );
    const { payment } = (await pay(user, session.sessionNumber, 'NO_CHARGE'))
      .body as CreatePaymentResponse;
    const done = (await portal(user.token).post(`/payments/${payment.id}/process`))
      .body as ProcessPaymentResponse;
    expect(done.receipt).toMatchObject({
      totalPaise: 0,
      ownerCategory: 'STAFF',
      payment: { method: 'NO_CHARGE' },
    });
  });

  it('refuses a no-charge method for a chargeable stay', async () => {
    const { user, session } = await parkedUntilThirteen();
    expect(errorCode((await pay(user, session.sessionNumber, 'NO_CHARGE')).body)).toBe(
      'INVALID_PAYMENT_METHOD',
    );
    expect((await pay(user, session.sessionNumber, 'BITCOIN')).status).toBe(400);
  });

  it('keeps the vehicle parked after a declined test payment and lets the user try again', async () => {
    const { user, session } = await parkedUntilThirteen();
    const first = (await pay(user, session.sessionNumber, 'UPI')).body as CreatePaymentResponse;
    const declined = await portal(user.token).post(`/payments/${first.payment.id}/process`, {
      outcome: 'FAILURE',
    });
    expect((declined.body as ProcessPaymentResponse).payment.status).toBe('FAILED');
    expect((declined.body as ProcessPaymentResponse).receipt).toBeNull();
    expect((await slotRow(session.slotCode)).status).toBe('OCCUPIED');

    const second = (await pay(user, session.sessionNumber, 'CARD')).body as CreatePaymentResponse;
    const ok = await portal(user.token).post(`/payments/${second.payment.id}/process`);
    expect((ok.body as ProcessPaymentResponse).receipt).not.toBeNull();
  });

  it('lets the user back out of a payment they started', async () => {
    const { user, session } = await parkedUntilThirteen();
    const { payment } = (await pay(user, session.sessionNumber, 'UPI'))
      .body as CreatePaymentResponse;
    const cancelled = await portal(user.token).post(`/payments/${payment.id}/cancel`);
    expect(cancelled.body.payment.status).toBe('CANCELLED');
    expect(
      ((await portal(user.token).get('/overview')).body as PortalOverview).pendingCheckouts,
    ).toEqual([]);
  });

  it('keeps the exit hour from going before the entry hour', async () => {
    const user = await driver('STUDENT', 'KA22AB1234');
    const { session } = await parkNow(user, user.vehicle.id);
    setCampusHour(7);
    expect(errorCode((await checkout(user, session.sessionNumber)).body)).toBe('EXIT_BEFORE_ENTRY');
    expect((await slotRow(session.slotCode)).status).toBe('OCCUPIED');
  });

  it('only checks out the user’s own sessions and payments', async () => {
    const { user, session } = await parkedUntilThirteen();
    const other = await driver('STUDENT', 'KA22CD5678');
    const { payment } = (await pay(user, session.sessionNumber, 'UPI'))
      .body as CreatePaymentResponse;

    expect(errorCode((await checkout(other, session.sessionNumber)).body)).toBe(
      'SESSION_NOT_FOUND',
    );
    expect(errorCode((await pay(other, session.sessionNumber, 'UPI')).body)).toBe(
      'SESSION_NOT_FOUND',
    );
    expect(
      errorCode((await portal(other.token).post(`/payments/${payment.id}/process`)).body),
    ).toBe('SESSION_NOT_FOUND');
    expect(errorCode((await portal(other.token).post(`/payments/${payment.id}/cancel`)).body)).toBe(
      'SESSION_NOT_FOUND',
    );
    expect(
      errorCode(
        (await portal(other.token).post('/payments/00000000-0000-4000-8000-000000000000/process'))
          .body,
      ),
    ).toBe('PAYMENT_NOT_FOUND');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'PENDING',
    );
  });

  it('needs an approved parking-user account', async () => {
    const { user, session } = await parkedUntilThirteen();
    const pending = await createParkingUser('STUDENT', 'PENDING');
    expect((await checkout(pending, session.sessionNumber)).status).toBe(403);
    for (const token of [adminToken, guardToken]) {
      const res = await request(app)
        .post(`${API}/portal/sessions/${session.sessionNumber}/checkout`)
        .set(bearer(token));
      expect(res.status).toBe(403);
    }
    expect(
      (await request(app).post(`${API}/portal/sessions/${session.sessionNumber}/checkout`)).status,
    ).toBe(401);
    void user;
  });

  it('leaves Security Staff checkout exactly as it was', async () => {
    const user = await driver('STUDENT', 'KA22AB1234');
    const parked = await parkNow(user, user.vehicle.id);
    setCampusHour(13);
    const done = await guard.checkOutOk(parked.session.sessionNumber, 12);
    expect(done.receipt).toMatchObject({ durationHours: 3, totalPaise: 1000 });
    const row = await prisma.parkingSession.findFirstOrThrow({});
    expect(row.checkedOutById).not.toBe(user.user.id);
  });
});

describe('visitor checkout and payment', () => {
  const visit = async (entryHour = 9) => {
    const parked = await guard.checkInOk('KA09ZZ0009', 'TWO_WHEELER', 'VISITOR', entryHour);
    const access = await request(app)
      .post(`${API}/visitor/access`)
      .send({ vehicleNumber: 'KA09ZZ0009', sessionNumber: parked.session.sessionNumber });
    return { parked, token: (access.body as VisitorAccessResponse).accessToken };
  };

  it('lets a visitor pay for their own stay and get the receipt, without an account', async () => {
    const { parked, token } = await visit(9);
    setCampusHour(13);
    const v = visitor(token);

    const quote = (await v.post('/checkout')).body as CheckoutQuote;
    expect(quote).toMatchObject({ exitHour: 13, durationHours: 4 });
    expect(quote.fee.totalPaise).toBe(8000); // visitor two-wheeler: 4 × ₹20

    const { payment } = (await v.post('/payments', { method: 'CARD' }))
      .body as CreatePaymentResponse;
    expect(payment).toMatchObject({ status: 'PENDING', amountPaise: 8000 });
    const paid = (await v.post(`/payments/${payment.id}/process`)).body as ProcessPaymentResponse;
    expect(paid.receipt).toMatchObject({
      sessionNumber: parked.session.sessionNumber,
      totalPaise: 8000,
    });

    expect(((await v.get('/receipt')).body as ReceiptView).receiptNumber).toBe(
      paid.receipt!.receiptNumber,
    );
    const row = await prisma.parkingSession.findFirstOrThrow({});
    expect(row).toMatchObject({ status: 'COMPLETED', checkedOutById: null });
    expect((await slotRow(parked.session.slotCode)).status).toBe('AVAILABLE');
    // The audit trail records a system action rather than an invented user.
    const entries = await prisma.auditLog.findMany({ where: { action: 'PAYMENT_SUCCEEDED' } });
    expect(entries.map((entry) => entry.actorId)).toEqual([null]);
  });

  it('keeps a visitor to their own session and payments', async () => {
    const mine = await visit(9);
    const student = await driver('STUDENT', 'KA22AB1234');
    const theirs = await parkNow(student, student.vehicle.id);
    setCampusHour(13);

    // A second visitor with their own payment.
    const second = await guard.checkInOk('KA08YY0008', 'TWO_WHEELER', 'VISITOR', 9);
    const secondAccess = await request(app)
      .post(`${API}/visitor/access`)
      .send({ vehicleNumber: 'KA08YY0008', sessionNumber: second.session.sessionNumber });
    const other = visitor((secondAccess.body as VisitorAccessResponse).accessToken);
    const { payment } = (await other.post('/payments', { method: 'UPI' }))
      .body as CreatePaymentResponse;

    const me = visitor(mine.token);
    expect(errorCode((await me.post(`/payments/${payment.id}/process`)).body)).toBe(
      'VISITOR_ACCESS_DENIED',
    );
    expect(errorCode((await me.post(`/payments/${payment.id}/cancel`)).body)).toBe(
      'VISITOR_ACCESS_DENIED',
    );
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'PENDING',
    );

    // The visitor token reaches only the visitor routes: not the portal, not operations.
    for (const path of [
      `/portal/sessions/${theirs.session.sessionNumber}/checkout`,
      '/parking/checkouts/quote',
      '/parking/payments',
    ]) {
      expect(
        (await request(app).post(`${API}${path}`).set(bearer(mine.token)).send({})).status,
      ).toBe(401);
    }
    // An account token is not a visitor token.
    for (const token of [student.token, guardToken, adminToken]) {
      expect((await request(app).post(`${API}/visitor/checkout`).set(bearer(token))).status).toBe(
        401,
      );
    }
    expect((await request(app).post(`${API}/visitor/checkout`)).status).toBe(401);
  });

  it('shows the visitor’s session as completed after payment, and offers no second checkout', async () => {
    const { token } = await visit(9);
    setCampusHour(13);
    const v = visitor(token);
    const { payment } = (await v.post('/payments', { method: 'UPI' }))
      .body as CreatePaymentResponse;
    await v.post(`/payments/${payment.id}/process`);
    expect(((await v.get('/session')).body as ParkingSessionView).status).toBe('COMPLETED');
    expect(errorCode((await v.post('/checkout')).body)).toBe('SESSION_NOT_ACTIVE');
  });
});

describe('the user’s session timeline', () => {
  it('lists the parking steps without operators, scores or refusals, and only for the owner', async () => {
    const user = await driver('STUDENT', 'KA22AB1234');
    const other = await driver('STUDENT', 'KA22CD5678');
    const parked = await parkNow(user, user.vehicle.id);
    setCampusHour(13);
    const { payment } = (
      await portal(user.token).post(`/sessions/${parked.session.sessionNumber}/payments`, {
        method: 'UPI',
      })
    ).body as CreatePaymentResponse;
    await portal(user.token).post(`/payments/${payment.id}/process`);

    const res = await portal(user.token).get(`/sessions/${parked.session.sessionNumber}/timeline`);
    const timeline = res.body as SessionTimelineResponse;
    expect(res.status).toBe(200);
    const actions = timeline.events.map((event) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'VEHICLE_CHECKED_IN',
        'SLOT_ASSIGNED',
        'PAYMENT_INITIATED',
        'PAYMENT_SUCCEEDED',
        'TRANSACTION_FINALIZED',
        'RECEIPT_GENERATED',
        'SLOT_RELEASED',
      ]),
    );
    expect(timeline.events.every((event) => event.actor === null)).toBe(true);
    expect(JSON.stringify(timeline)).not.toMatch(/score|"role"|fullName|DECLINED/);

    expect(
      errorCode(
        (await portal(other.token).get(`/sessions/${parked.session.sessionNumber}/timeline`)).body,
      ),
    ).toBe('SESSION_NOT_FOUND');
    expect(
      (await request(app).get(`${API}/portal/sessions/${parked.session.sessionNumber}/timeline`))
        .status,
    ).toBe(401);
  });
});

describe('notifications', () => {
  it('tells a user about a verification decision even while their account is not yet approved', async () => {
    const pending = await createParkingUser('STUDENT', 'PENDING');
    const a = admin(adminToken);
    await a.post(`/users/${pending.user.id}/verification`, {
      decision: 'REJECT',
      note: 'Blurred photo',
    });

    expect((await portal(pending.token).get('/overview')).status).toBe(403);
    const list = (await portal(pending.token).get('/notifications')).body as NotificationsResponse;
    expect(list.unreadCount).toBe(1);
    expect(list.items[0]).toMatchObject({
      type: 'VERIFICATION_REJECTED',
      data: { note: 'Blurred photo' },
      readAt: null,
    });

    await prisma.parkingUserProfile.update({
      where: { userId: pending.user.id },
      data: { verificationStatus: 'PENDING' },
    });
    // The clock is frozen in these tests: let a minute pass so "newest first" is meaningful.
    vi.advanceTimersByTime(60_000);
    await a.post(`/users/${pending.user.id}/verification`, { decision: 'VERIFY' });
    const after = (await portal(pending.token).get('/notifications')).body as NotificationsResponse;
    expect(after.items.map((item) => item.type)).toEqual([
      'VERIFICATION_APPROVED',
      'VERIFICATION_REJECTED',
    ]);
    expect(after.unreadCount).toBe(2);
  });

  it('tells an owner when security checks their vehicle in, but not for their own Park now', async () => {
    const student = await driver('STUDENT', 'KA22AB1234');
    const other = await driver('STUDENT', 'KA22CD5678');
    await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 9);
    await parkNow(other, other.vehicle.id);

    const mine = (await portal(student.token).get('/notifications')).body as NotificationsResponse;
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({
      type: 'VEHICLE_CHECKED_IN',
      data: { vehicleNumber: 'KA22AB1234', slotCode: 'T-01' },
    });
    expect(
      ((await portal(other.token).get('/notifications')).body as NotificationsResponse).items,
    ).toEqual([]);
  });

  it('marks notices read one at a time or all at once, for the owner only', async () => {
    const student = await driver('STUDENT', 'KA22AB1234');
    const other = await driver('STUDENT', 'KA22CD5678');
    for (const slot of ['KA22AB1234']) await guard.checkInOk(slot, 'TWO_WHEELER', 'VISITOR', 9);
    await prisma.notification.create({
      data: {
        userId: student.user.id,
        type: 'RECEIPT_GENERATED',
        data: { receiptNumber: 'CPVTS-R-2026-AAAAAAAA' },
      },
    });
    const list = (await portal(student.token).get('/notifications')).body as NotificationsResponse;
    expect(list.unreadCount).toBe(2);
    const id = list.items[0]!.id;

    expect((await portal(other.token).post(`/notifications/${id}/read`)).status).toBe(404);
    expect(errorCode((await portal(other.token).post(`/notifications/${id}/read`)).body)).toBe(
      'NOTIFICATION_NOT_FOUND',
    );
    expect((await portal(student.token).post('/notifications/not-a-uuid/read')).status).toBe(400);

    expect((await portal(student.token).post(`/notifications/${id}/read`)).status).toBe(204);
    expect(
      ((await portal(student.token).get('/notifications')).body as NotificationsResponse)
        .unreadCount,
    ).toBe(1);
    expect((await portal(student.token).post('/notifications/read-all')).status).toBe(204);
    expect(
      ((await portal(student.token).get('/notifications')).body as NotificationsResponse)
        .unreadCount,
    ).toBe(0);
  });

  it('is private to parking users', async () => {
    expect((await request(app).get(`${API}/portal/notifications`)).status).toBe(401);
    for (const token of [adminToken, guardToken]) {
      expect(
        (await request(app).get(`${API}/portal/notifications`).set(bearer(token))).status,
      ).toBe(403);
    }
  });
});

describe('what the home, profile and dashboard are built from', () => {
  it('lists the user’s vehicles with their live parking state', async () => {
    const student = await user2Vehicles();
    const parked = await parkNow(student, student.a.id);
    const overview = (await portal(student.token).get('/overview')).body as PortalOverview;
    expect(overview.vehicleCount).toBe(2);
    expect(
      overview.vehicles.map((vehicle) => [
        vehicle.vehicleNumber,
        vehicle.activeSession?.slotCode ?? null,
      ]),
    ).toEqual([
      ['KA22AB1111', parked.session.slotCode],
      ['KA22AB2222', null],
    ]);
    expect(overview.lastCompleted).toBeNull();
    expect(overview.pendingCheckouts).toEqual([]);
  });

  it('shows each account its own official pricing', async () => {
    const student = await createParkingUser('STUDENT');
    const staff = await createParkingUser('STAFF');
    const studentPricing = (
      (await portal(student.token).get('/profile')).body as ParkingUserProfileView
    ).pricing;
    expect(studentPricing).toEqual({
      TWO_WHEELER: { type: 'FREE_HOURS_THEN_HOURLY', freeHours: 2, hourlyRatePaise: 1000 },
      FOUR_WHEELER: { type: 'FREE_HOURS_THEN_HOURLY', freeHours: 2, hourlyRatePaise: 2000 },
    });
    expect(
      ((await portal(staff.token).get('/profile')).body as ParkingUserProfileView).pricing,
    ).toEqual({
      TWO_WHEELER: { type: 'FREE' },
      FOUR_WHEELER: { type: 'FREE' },
    });
    await prisma.setting.deleteMany();
    expect(
      ((await portal(staff.token).get('/profile')).body as ParkingUserProfileView).pricing,
    ).toBeNull();
  });

  it('gives administrators — and only them — the user figures for the dashboard', async () => {
    await createParkingUser('STUDENT', 'PENDING');
    await createParkingUser('STUDENT', 'PENDING');
    await createParkingUser('STAFF', 'PENDING');
    const driverUser = await driver('STUDENT', 'KA22AB1234');
    await parkNow(driverUser, driverUser.vehicle.id);

    const forAdmin = (await request(app).get(`${API}/dashboard/summary`).set(bearer(adminToken)))
      .body as DashboardSummary;
    expect(forAdmin.users).toEqual({
      pendingStudentVerifications: 2,
      pendingStaffVerifications: 1,
      activeParkingUsers: 1,
    });
    expect(forAdmin.currentlyParked).toBe(1);
    expect(((await guard.summary()).body as DashboardSummary).users).toBeNull();
  });
});
