import type {
  CheckInResponse,
  CheckoutQuote,
  CreatePaymentResponse,
  ProcessPaymentResponse,
  VehicleType,
} from '@cpvts/shared';
import type { Express } from 'express';
import request from 'supertest';

import { prisma } from '../src/db/prisma.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { campusDateString } from '../src/lib/campus-time.js';
import { tokenService } from '../src/modules/auth/token.service.js';
import { OFFICIAL_FEE_SCHEDULE } from '../src/modules/fees/official-fee-schedule.js';
import { createUser } from './helpers.js';

export { OFFICIAL_FEE_SCHEDULE };

/** Master Blueprint §5 minimum layout: T-01…T-10 and F-01…F-05, all AVAILABLE. */
export const seedLayout = async (): Promise<void> => {
  const layout: [string, string, VehicleType, string, number][] = [
    ['BLOCK-2W', 'Two-Wheeler Parking Block', 'TWO_WHEELER', 'T', 10],
    ['BLOCK-4W', 'Four-Wheeler Parking Block', 'FOUR_WHEELER', 'F', 5],
  ];
  for (const [index, [code, name, vehicleType, prefix, count]] of layout.entries()) {
    await prisma.parkingBlock.create({
      data: {
        code,
        name,
        sortOrder: index,
        zones: {
          create: {
            code: `ZONE-${code.slice(-2)}`,
            name: `${name.split(' Parking')[0]} Zone`,
            vehicleType,
            slots: {
              create: Array.from({ length: count }, (_, i) => ({
                code: `${prefix}-${String(i + 1).padStart(2, '0')}`,
                sortOrder: i,
              })),
            },
          },
        },
      },
    });
  }
};

export const seedFees = (schedule: Prisma.InputJsonValue = OFFICIAL_FEE_SCHEDULE) =>
  prisma.setting.create({ data: { key: 'parking.feeSchedule', value: schedule } });

const HOUR_MS = 3_600_000;

/**
 * An ACTIVE duty shift for a guard that is on duty right now and stays so for three days, so
 * gate operations (which need an on-duty shift) work in tests that are not about shifts, even
 * with the clock moved a day ahead.
 */
export const startShift = (
  staffId: string,
  overrides: Partial<Prisma.SecurityShiftUncheckedCreateInput> = {},
) => {
  const now = Date.now();
  return prisma.securityShift.create({
    data: {
      staffId,
      shiftName: 'Test shift',
      shiftDate: new Date(`${campusDateString(new Date(now))}T00:00:00.000Z`),
      startsAt: new Date(now - HOUR_MS),
      endsAt: new Date(now + 72 * HOUR_MS),
      status: 'ACTIVE',
      checkedInAt: new Date(now - HOUR_MS),
      gate: 'Main Gate',
      ...overrides,
    },
  });
};

/**
 * Creates a user and returns a bearer token without going through bcrypt login. A Security
 * Staff member comes with an on-duty shift (pass `{ onDuty: false }` for one without).
 */
export const signIn = async (
  role: 'ADMIN' | 'SECURITY_STAFF',
  username: string,
  { onDuty = true }: { onDuty?: boolean } = {},
) => {
  const user = await createUser(role, username);
  const shift = role === 'SECURITY_STAFF' && onDuty ? await startShift(user.id) : null;
  return { user, shift, token: tokenService.issueAccessToken(user.id, user.tokenVersion).token };
};

export const slotStatus = async (code: string) =>
  (await prisma.parkingSlot.findUniqueOrThrow({ where: { code } })).status;

export const setSlotStatus = (code: string, status: 'AVAILABLE' | 'OCCUPIED' | 'BLOCKED') =>
  prisma.parkingSlot.update({ where: { code }, data: { status } });

export const parkingApi = (app: Express, token: string) => {
  const auth = { Authorization: `Bearer ${token}` };
  return {
    checkIn: (body: Record<string, unknown>) =>
      request(app).post('/api/v1/parking/check-ins').set(auth).send(body),
    async checkInOk(
      vehicleNumber: string,
      vehicleType: VehicleType = 'TWO_WHEELER',
      ownerCategory = 'STUDENT',
      entryHour = 9,
    ): Promise<CheckInResponse> {
      const res = await this.checkIn({ vehicleNumber, vehicleType, ownerCategory, entryHour });
      if (res.status !== 201) throw new Error(`check-in failed: ${JSON.stringify(res.body)}`);
      return res.body as CheckInResponse;
    },
    track: (q: string) => request(app).get('/api/v1/parking/tracking').query({ q }).set(auth),
    map: () => request(app).get('/api/v1/parking/map').set(auth),
    active: (query: Record<string, string | number | boolean> = {}) =>
      request(app).get('/api/v1/parking/sessions/active').query(query).set(auth),
    /** Camera checkout: the scanned text of the session QR. */
    scan: (qr: string) =>
      request(app).post('/api/v1/parking/checkouts/scan').set(auth).send({ qr }),
    session: (sessionNumber: string) =>
      request(app).get(`/api/v1/parking/sessions/${sessionNumber}`).set(auth),
    quote: (body: Record<string, unknown>) =>
      request(app).post('/api/v1/parking/checkouts/quote').set(auth).send(body),
    createPayment: (body: Record<string, unknown>) =>
      request(app).post('/api/v1/parking/payments').set(auth).send(body),
    process: (paymentId: string, body: Record<string, unknown>) =>
      request(app).post(`/api/v1/parking/payments/${paymentId}/process`).set(auth).send(body),
    cancel: (paymentId: string, body: Record<string, unknown>) =>
      request(app).post(`/api/v1/parking/payments/${paymentId}/cancel`).set(auth).send(body),
    receipt: (receiptNumber: string) =>
      request(app).get(`/api/v1/parking/receipts/${receiptNumber}`).set(auth),
    summary: () => request(app).get('/api/v1/dashboard/summary').set(auth),
    /** Full checkout. Uses NO_CHARGE for ₹0 and the given method otherwise. */
    async checkOutOk(
      sessionNumber: string,
      exitHour: number,
      chargeableMethod = 'UPI',
    ): Promise<ProcessPaymentResponse> {
      const quote = await this.quote({ sessionNumber, exitHour });
      if (quote.status !== 200) throw new Error(`quote failed: ${JSON.stringify(quote.body)}`);
      const method =
        (quote.body as CheckoutQuote).fee.totalPaise === 0 ? 'NO_CHARGE' : chargeableMethod;
      const created = await this.createPayment({ sessionNumber, exitHour, method });
      if (created.status !== 201)
        throw new Error(`payment failed: ${JSON.stringify(created.body)}`);
      const { payment } = created.body as CreatePaymentResponse;
      const processed = await this.process(payment.id, { sessionNumber });
      if (processed.status !== 200)
        throw new Error(`process failed: ${JSON.stringify(processed.body)}`);
      return processed.body as ProcessPaymentResponse;
    },
  };
};
