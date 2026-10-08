import type { CashSummaryResponse, MyShiftResponse, ShiftView } from '@cpvts/shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ConfigModule from '../src/config/index.js';

// This file runs the API with SHIFT_ENFORCEMENT=optional (the rest of the suite uses the default,
// `required`). Only that one setting is replaced.
vi.mock('../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof ConfigModule>();
  return {
    ...original,
    config: Object.freeze({
      ...original.config,
      shifts: Object.freeze({ ...original.config.shifts, enforcement: 'optional' as const }),
    }),
  };
});

const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config/index.js');
const { disconnectDatabase, prisma } = await import('../src/db/prisma.js');
const { resetDatabase } = await import('./helpers.js');
const { parkingApi, seedFees, seedLayout, signIn } = await import('./parking-helpers.js');
const { client } = await import('./user-helpers.js');

const app = createApp(config);
let admin: ReturnType<typeof client>;

beforeEach(async () => {
  await resetDatabase();
  await seedLayout();
  await seedFees();
  admin = client(app, (await signIn('ADMIN', 'boss')).token);
});

afterAll(disconnectDatabase);

describe('with shifts optional', () => {
  it('reports the setting to the guard', async () => {
    const guard = await signIn('SECURITY_STAFF', 'guard', { onDuty: false });
    const mine = (await client(app, guard.token).get('/security/shift')).body as MyShiftResponse;
    expect(mine).toMatchObject({ onDuty: false, current: null, enforcement: 'optional' });
  });

  it('lets a guard without a shift work, and reports the cash that belongs to no shift', async () => {
    const guard = await signIn('SECURITY_STAFF', 'guard', { onDuty: false });
    const api = parkingApi(app, guard.token);
    const entry = await api.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 9);
    const done = await api.checkOutOk(entry.session.sessionNumber, 12, 'CASH');
    expect(done.payment).toMatchObject({ status: 'PAID', amountPaise: 6000 });

    // Still recorded against the guard, but against no shift.
    const payment = await prisma.payment.findFirstOrThrow();
    expect(payment).toMatchObject({ processedById: guard.user.id, shiftId: null });

    // It cannot silently disappear: the cash overview reports it.
    const summary = (await admin.get('/admin/cash/summary')).body as CashSummaryResponse;
    expect(summary.unattributedCash).toEqual({ transactions: 1, amountPaise: 6000 });
    expect(summary.administratorCash).toEqual({ transactions: 0, amountPaise: 0 });
  });

  it('still attributes what a guard with a shift does to that shift', async () => {
    const guard = await signIn('SECURITY_STAFF', 'guard'); // on duty
    const api = parkingApi(app, guard.token);
    const entry = await api.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 9);
    await api.checkOutOk(entry.session.sessionNumber, 12, 'CASH');

    expect((await prisma.payment.findFirstOrThrow()).shiftId).toBe(guard.shift!.id);
    const shift = (await admin.get(`/admin/shifts/${guard.shift!.id}`)).body as ShiftView;
    expect(shift.cash).toMatchObject({ cashTransactions: 1, expectedCashPaise: 6000 });
    const summary = (await admin.get('/admin/cash/summary')).body as CashSummaryResponse;
    expect(summary.unattributedCash.transactions).toBe(0);
  });
});
