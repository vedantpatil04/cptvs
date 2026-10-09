import type {
  ApiErrorBody,
  CheckInResponse,
  MyShiftResponse,
  NotificationsResponse,
  Page,
  RosterResponse,
  SecurityStaffMember,
  ShiftTemplateView,
  ShiftView,
} from '@cpvts/shared';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { disconnectDatabase, prisma } from '../src/db/prisma.js';
import { campusInstant } from '../src/lib/campus-time.js';
import { tokenService } from '../src/modules/auth/token.service.js';
import {
  effectiveStatus,
  flagsOf,
  isOnDuty,
  windowFor,
} from '../src/modules/shifts/shift-policy.js';
import { resetDatabase, TEST_PASSWORD } from './helpers.js';
import { parkingApi, seedFees, seedLayout, signIn } from './parking-helpers.js';
import { client, createParkingUser, errorCode } from './user-helpers.js';

/**
 * Security Staff shifts. The clock is pinned (only `Date`) to a mid-week campus morning so
 * "08:00–16:00" means the same thing wherever the suite runs; tokens are re-issued whenever
 * the clock moves so a login never "expires" in the middle of a scenario.
 */

const app = createApp(config);
const DAY = '2026-11-02';
const NEXT_DAY = '2026-11-03';

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const instant = (hhmm: string, day = DAY): Date => campusInstant(day, minutes(hhmm));
const clock = (hhmm: string, day = DAY): void => {
  vi.setSystemTime(instant(hhmm, day));
};
const as = (user: { id: string; tokenVersion: number }) =>
  client(app, tokenService.issueAccessToken(user.id, user.tokenVersion).token);

type Client = ReturnType<typeof client>;
let adminUser: { id: string; tokenVersion: number };
const admin: Pick<Client, 'get' | 'post' | 'patch' | 'delete'> = {
  get: (...args) => as(adminUser).get(...args),
  post: (...args) => as(adminUser).post(...args),
  patch: (...args) => as(adminUser).patch(...args),
  delete: (...args) => as(adminUser).delete(...args),
};
let guardUser: { id: string; tokenVersion: number };
const templates: Record<string, ShiftTemplateView> = {};

const makeTemplate = async (name: string, startTime: string, endTime: string) => {
  const res = await admin.post('/admin/shift-templates', { name, startTime, endTime });
  expect(res.status, name).toBe(201);
  return res.body as ShiftTemplateView;
};

const assign = (
  templateName: string,
  staffId = guardUser.id,
  extra: Record<string, unknown> = {},
  day = DAY,
) =>
  admin.post('/admin/shifts', {
    staffId,
    date: day,
    templateId: templates[templateName]!.id,
    gate: 'Main Gate',
    ...extra,
  });

const assigned = async (...args: Parameters<typeof assign>) => {
  const res = await assign(...args);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as ShiftView;
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock('06:00');
  await resetDatabase();
  await seedLayout();
  await seedFees();
  const boss = await signIn('ADMIN', 'boss');
  adminUser = boss.user;
  guardUser = (await signIn('SECURITY_STAFF', 'guard1', { onDuty: false })).user;
  templates.Morning = await makeTemplate('Morning', '08:00', '16:00');
  templates.Evening = await makeTemplate('Evening', '16:00', '00:00');
  templates.Night = await makeTemplate('Night', '00:00', '08:00');
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(disconnectDatabase);

describe('the shift rules themselves', () => {
  const shift = (overrides: Partial<Parameters<typeof effectiveStatus>[0]> = {}) => ({
    status: 'SCHEDULED' as const,
    startsAt: instant('08:00'),
    endsAt: instant('16:00'),
    checkedInAt: null,
    checkedOutAt: null,
    ...overrides,
  });

  it('turns a template and a date into real instants, across midnight too', () => {
    const morning = windowFor(DAY, minutes('08:00'), minutes('16:00'));
    expect(morning.startsAt.toISOString()).toBe(instant('08:00').toISOString());
    expect(morning.endsAt.toISOString()).toBe(instant('16:00').toISOString());
    const evening = windowFor(DAY, minutes('16:00'), 0);
    expect(evening.endsAt.toISOString()).toBe(instant('00:00', NEXT_DAY).toISOString());
    const night = windowFor(DAY, minutes('22:00'), minutes('06:00'));
    expect(night.endsAt.toISOString()).toBe(instant('06:00', NEXT_DAY).toISOString());
  });

  it('reads the clock for the two states that need no action', () => {
    clock('08:30');
    expect(effectiveStatus(shift({ status: 'CHECKED_IN', checkedInAt: instant('07:40') }))).toBe(
      'ACTIVE',
    );
    clock('07:30');
    expect(effectiveStatus(shift({ status: 'CHECKED_IN', checkedInAt: instant('07:20') }))).toBe(
      'CHECKED_IN',
    );
    clock('16:01');
    expect(effectiveStatus(shift())).toBe('MISSED');
    clock('12:00');
    expect(effectiveStatus(shift())).toBe('SCHEDULED');
  });

  it('is on duty only while checked in, started and within the end plus the grace period', () => {
    const active = shift({ status: 'ACTIVE', checkedInAt: instant('08:00') });
    clock('07:59');
    expect(isOnDuty(active)).toBe(false);
    clock('08:00');
    expect(isOnDuty(active)).toBe(true);
    clock('16:30'); // the default grace is 30 minutes
    expect(isOnDuty(active)).toBe(true);
    clock('16:31');
    expect(isOnDuty(active)).toBe(false);
    expect(
      isOnDuty(
        shift({
          status: 'CHECKED_OUT',
          checkedInAt: instant('08:00'),
          checkedOutAt: instant('12:00'),
        }),
      ),
    ).toBe(false);
  });

  it('flags late check-ins and early check-outs, within a ten-minute tolerance', () => {
    expect(flagsOf(shift({ checkedInAt: instant('08:10') }))).toEqual([]);
    expect(flagsOf(shift({ checkedInAt: instant('08:11') }))).toEqual(['LATE']);
    expect(
      flagsOf(shift({ checkedInAt: instant('08:00'), checkedOutAt: instant('15:50') })),
    ).toEqual([]);
    expect(
      flagsOf(shift({ checkedInAt: instant('08:00'), checkedOutAt: instant('15:49') })),
    ).toEqual(['EARLY_CHECKOUT']);
    expect(
      flagsOf(shift({ checkedInAt: instant('08:30'), checkedOutAt: instant('12:00') })),
    ).toEqual(['LATE', 'EARLY_CHECKOUT']);
  });
});

describe('shift templates', () => {
  it('describes the starter patterns, including ones that end after midnight', async () => {
    expect(templates.Morning).toMatchObject({
      startTime: '08:00',
      endTime: '16:00',
      crossesMidnight: false,
      durationMinutes: 480,
      isActive: true,
    });
    expect(templates.Evening).toMatchObject({
      startTime: '16:00',
      endTime: '00:00',
      crossesMidnight: true,
    });
    expect(templates.Night).toMatchObject({
      startTime: '00:00',
      endTime: '08:00',
      crossesMidnight: false,
    });
    const late = await makeTemplate('Late night', '22:00', '06:00');
    expect(late).toMatchObject({ crossesMidnight: true, durationMinutes: 480 });
  });

  it('lets Admin create and edit any template, not just these three', async () => {
    const split = await makeTemplate('Peak hours', '07:30', '10:30');
    expect(split.durationMinutes).toBe(180);
    const renamed = await admin.patch(`/admin/shift-templates/${split.id}`, {
      name: 'Morning peak',
      endTime: '11:00',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({
      name: 'Morning peak',
      endTime: '11:00',
      durationMinutes: 210,
    });

    const retired = await admin.patch(`/admin/shift-templates/${split.id}`, { isActive: false });
    expect((retired.body as ShiftTemplateView).isActive).toBe(false);
    const active = (await admin.get('/admin/shift-templates')).body as ShiftTemplateView[];
    expect(active.map((t) => t.name)).not.toContain('Morning peak');
    const all = (await admin.get('/admin/shift-templates', { includeInactive: true }))
      .body as ShiftTemplateView[];
    expect(all.map((t) => t.name)).toContain('Morning peak');
    // A retired template cannot be assigned any more.
    expect(
      errorCode(
        await admin.post('/admin/shifts', {
          staffId: guardUser.id,
          date: NEXT_DAY,
          templateId: split.id,
        }),
      ),
    ).toBe('SHIFT_TEMPLATE_NOT_FOUND');
  });

  it('keeps names unique and times sensible', async () => {
    expect(
      errorCode(
        await admin.post('/admin/shift-templates', {
          name: 'morning',
          startTime: '09:00',
          endTime: '10:00',
        }),
      ),
    ).toBe('SHIFT_TEMPLATE_NAME_TAKEN');
    for (const body of [
      { name: 'Same', startTime: '08:00', endTime: '08:00' },
      { name: 'Bad', startTime: '24:00', endTime: '08:00' },
      { name: 'Bad', startTime: '8:00', endTime: '09:00' },
      { name: '', startTime: '08:00', endTime: '09:00' },
    ]) {
      expect((await admin.post('/admin/shift-templates', body)).status, JSON.stringify(body)).toBe(
        400,
      );
    }
    const res = await admin.patch(`/admin/shift-templates/${templates.Morning!.id}`, {
      endTime: '08:00',
    });
    expect(res.status).toBe(400); // the merged result would start and end together
    expect(
      errorCode(
        await admin.patch(`/admin/shift-templates/${templates.Evening!.id}`, { name: 'MORNING' }),
      ),
    ).toBe('SHIFT_TEMPLATE_NAME_TAKEN');
    expect(
      errorCode(
        await admin.patch('/admin/shift-templates/00000000-0000-4000-8000-000000000000', {
          name: 'x',
        }),
      ),
    ).toBe('SHIFT_TEMPLATE_NOT_FOUND');
  });

  it('never rewrites a shift that was already assigned', async () => {
    const shift = await assigned('Morning', guardUser.id, {}, NEXT_DAY);
    await admin.patch(`/admin/shift-templates/${templates.Morning!.id}`, {
      name: 'Day',
      startTime: '09:00',
      endTime: '17:00',
    });
    const again = (await admin.get(`/admin/shifts/${shift.id}`)).body as ShiftView;
    expect(again).toMatchObject({
      name: 'Morning',
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
    });
  });

  it('is for administrators only', async () => {
    const guard = as(guardUser);
    expect((await guard.get('/admin/shift-templates')).status).toBe(403);
    expect(
      (
        await guard.post('/admin/shift-templates', {
          name: 'x',
          startTime: '01:00',
          endTime: '02:00',
        })
      ).status,
    ).toBe(403);
    expect((await client(app).get('/admin/shift-templates')).status).toBe(401);
  });
});

describe('Security Staff accounts', () => {
  it('are created by an administrator, sign in with a username, and can be listed', async () => {
    const created = await admin.post('/admin/security-staff', {
      username: ' Security.2 ',
      fullName: 'Security Two',
      password: TEST_PASSWORD,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      username: 'security.2',
      fullName: 'Security Two',
      isActive: true,
      onDutyShift: null,
    });

    const login = await client(app).post('/auth/login', {
      username: 'security.2',
      password: TEST_PASSWORD,
    });
    expect(login.status).toBe(200);
    expect((login.body as { user: { role: string } }).user.role).toBe('SECURITY_STAFF');

    const list = (await admin.get('/admin/security-staff')).body as SecurityStaffMember[];
    expect(list.map((m) => m.username).sort()).toEqual(['guard1', 'security.2']);

    expect(
      errorCode(
        await admin.post('/admin/security-staff', {
          username: 'SECURITY.2',
          fullName: 'Again',
          password: TEST_PASSWORD,
        }),
      ),
    ).toBe('CONFLICT');
    for (const body of [
      { username: 'ab', fullName: 'Short', password: TEST_PASSWORD },
      { username: 'ok.name', fullName: 'Weak', password: 'short' },
      { username: 'bad name', fullName: 'Space', password: TEST_PASSWORD },
    ]) {
      expect((await admin.post('/admin/security-staff', body)).status, JSON.stringify(body)).toBe(
        400,
      );
    }
  });

  it('can have their password reset, which signs them out everywhere', async () => {
    const guard = as(guardUser);
    expect((await guard.get('/security/shift')).status).toBe(200);
    const reset = await admin.post(`/admin/security-staff/${guardUser.id}/password`, {
      password: 'a-brand-new-password',
    });
    expect(reset.status).toBe(204);
    expect((await guard.get('/security/shift')).status).toBe(401); // the old token is revoked
    const oldPassword = await client(app).post('/auth/login', {
      username: 'guard1',
      password: TEST_PASSWORD,
    });
    expect(errorCode(oldPassword)).toBe('INVALID_CREDENTIALS');
    const newPassword = await client(app).post('/auth/login', {
      username: 'guard1',
      password: 'a-brand-new-password',
    });
    expect(newPassword.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_RESET' } })).toBe(1);
  });

  it('are managed by administrators only', async () => {
    const student = await createParkingUser();
    for (const token of [as(guardUser), client(app, student.token)]) {
      expect((await token.get('/admin/security-staff')).status).toBe(403);
      expect(
        (
          await token.post('/admin/security-staff', {
            username: 'x.y.z',
            fullName: 'Nope',
            password: TEST_PASSWORD,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await token.post(`/admin/security-staff/${guardUser.id}/password`, {
            password: TEST_PASSWORD,
          })
        ).status,
      ).toBe(403);
    }
  });
});

describe('assigning shifts and the daily roster', () => {
  it('assigns a guard to a template’s shift on a date, with the gate and a note', async () => {
    const shift = await assigned('Morning', guardUser.id, { note: 'Cover the NCC parade' });
    expect(shift).toMatchObject({
      name: 'Morning',
      date: DAY,
      gate: 'Main Gate',
      note: 'Cover the NCC parade',
      status: 'SCHEDULED',
      onDuty: false,
      flags: [],
      cashStatus: 'NOT_DUE',
      staff: { id: guardUser.id, username: 'guard1' },
      cash: { transactions: 0, expectedCashPaise: 0, digitalPaise: 0, totalPaise: 0 },
    });
    expect(shift.startsAt).toBe(instant('08:00').toISOString());
    expect(shift.endsAt).toBe(instant('16:00').toISOString());

    const evening = await assigned('Evening', guardUser.id);
    expect(evening.endsAt).toBe(instant('00:00', NEXT_DAY).toISOString()); // ends after midnight

    // The guard is told, and the assignment is audited.
    const notices = (await as(guardUser).get('/notifications')).body as NotificationsResponse;
    // (The clock is pinned, so both notifications share a timestamp: do not rely on their order.)
    expect(notices.items.map((n) => n.kind)).toEqual(['SHIFT_ASSIGNED', 'SHIFT_ASSIGNED']);
    expect(notices.items.map((n) => n.params.shiftName).sort()).toEqual(['Evening', 'Morning']);
    expect(notices.items.find((n) => n.params.shiftName === 'Evening')?.params).toMatchObject({
      date: DAY,
      gate: 'Main Gate',
    });
    expect(await prisma.auditLog.count({ where: { action: 'SHIFT_ASSIGNED' } })).toBe(2);
  });

  it('detects conflicts: overlapping shifts of one person are refused, back-to-back ones are not', async () => {
    await assigned('Morning');
    const noon = await makeTemplate('Noon', '12:00', '20:00');
    const overlap = await admin.post('/admin/shifts', {
      staffId: guardUser.id,
      date: DAY,
      templateId: noon.id,
    });
    expect(overlap.status).toBe(409);
    expect(errorCode(overlap)).toBe('SHIFT_CONFLICT');

    await assigned('Evening'); // starts exactly when the morning shift ends
    // Another guard may work the same hours at the same gate.
    const second = (await signIn('SECURITY_STAFF', 'guard2', { onDuty: false })).user;
    await assigned('Morning', second.id);
    // The Night shift of the following day does not touch Evening (which ends at midnight).
    await assigned('Night', guardUser.id, {}, NEXT_DAY);
    // A cross-midnight shift conflicts with the next day’s early shift.
    const late = await makeTemplate('Late night', '22:00', '06:00');
    const clash = await admin.post('/admin/shifts', {
      staffId: guardUser.id,
      date: DAY,
      templateId: late.id,
    });
    expect(errorCode(clash)).toBe('SHIFT_CONFLICT');
  });

  it('lets only one of two simultaneous identical assignments through', async () => {
    const results = await Promise.all([assign('Morning'), assign('Morning')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.securityShift.count()).toBe(1);
  });

  it('accepts only an active Security Staff member, a live template and a shift that has not ended', async () => {
    const student = await createParkingUser();
    expect(errorCode(await assign('Morning', student.user.id))).toBe('SECURITY_STAFF_NOT_FOUND');
    expect(errorCode(await assign('Morning', adminUser.id))).toBe('SECURITY_STAFF_NOT_FOUND');
    expect(errorCode(await assign('Morning', '00000000-0000-4000-8000-000000000000'))).toBe(
      'SECURITY_STAFF_NOT_FOUND',
    );
    await admin.post(`/admin/users/${guardUser.id}/status`, { isActive: false });
    expect(errorCode(await assign('Morning'))).toBe('SECURITY_STAFF_NOT_FOUND');
    await admin.post(`/admin/users/${guardUser.id}/status`, { isActive: true });

    clock('17:00'); // the morning shift is over
    expect(errorCode(await assign('Morning'))).toBe('SHIFT_INVALID_STATE');
    clock('06:00');
    expect((await assign('Morning')).status).toBe(201);
    expect(
      (
        await admin.post('/admin/shifts', {
          staffId: guardUser.id,
          date: 'tomorrow',
          templateId: templates.Night!.id,
        })
      ).status,
    ).toBe(400);
  });

  it('shows the daily roster with who has no shift yet', async () => {
    const second = (await signIn('SECURITY_STAFF', 'guard2', { onDuty: false })).user;
    await assigned('Evening');
    await assigned('Morning');
    const roster = (await admin.get('/admin/shifts/roster', { date: DAY })).body as RosterResponse;
    expect(roster.date).toBe(DAY);
    expect(roster.templates.map((t) => t.name)).toEqual(['Night', 'Morning', 'Evening']); // by start time
    expect(roster.shifts.map((s) => s.name)).toEqual(['Morning', 'Evening']);
    expect(roster.unassignedStaff).toEqual([
      { id: second.id, fullName: 'SECURITY_STAFF user', username: 'guard2' },
    ]);
    // With no date it is today’s roster.
    expect(((await admin.get('/admin/shifts/roster')).body as RosterResponse).date).toBe(DAY);
  });

  it('corrects a shift: gate and note any time, and its times (start and end) until it is finished', async () => {
    const shift = await assigned('Morning');
    const edited = await admin.patch(`/admin/shifts/${shift.id}`, {
      gate: 'North Gate',
      note: null,
    });
    expect(edited.body).toMatchObject({ gate: 'North Gate', note: null });

    const moved = await admin.patch(`/admin/shifts/${shift.id}`, {
      startsAt: instant('09:00').toISOString(),
      endsAt: instant('15:30').toISOString(),
    });
    expect(moved.body).toMatchObject({
      startsAt: instant('09:00').toISOString(),
      endsAt: instant('15:30').toISOString(),
    });
    // A shift must end after it starts.
    const backwards = await admin.patch(`/admin/shifts/${shift.id}`, {
      startsAt: instant('18:00').toISOString(),
    });
    expect(backwards.status).toBe(400);

    // The window can not be stretched into the guard's next shift.
    await assigned('Evening');
    const into = await admin.patch(`/admin/shifts/${shift.id}`, {
      endsAt: instant('16:30').toISOString(),
    });
    expect(errorCode(into)).toBe('SHIFT_CONFLICT');

    // Once checked in, both ends can still be corrected while the window covers the present.
    clock('09:30');
    await as(guardUser).post('/security/shift/check-in', {});
    const extended = await admin.patch(`/admin/shifts/${shift.id}`, {
      endsAt: instant('15:45').toISOString(),
    });
    expect(extended.status).toBe(200);
    const earlier = await admin.patch(`/admin/shifts/${shift.id}`, {
      startsAt: instant('08:00').toISOString(),
    });
    expect(earlier.status).toBe(200);
    // A guard on duty can not be given a start in the future, nor a window that has already ended.
    const future = await admin.patch(`/admin/shifts/${shift.id}`, {
      startsAt: instant('11:00').toISOString(),
    });
    expect(errorCode(future)).toBe('SHIFT_INVALID_STATE');
    const over = await admin.patch(`/admin/shifts/${shift.id}`, {
      endsAt: instant('09:00').toISOString(),
    });
    expect(errorCode(over)).toBe('SHIFT_INVALID_STATE');
    expect(
      errorCode(
        await admin.patch('/admin/shifts/00000000-0000-4000-8000-000000000000', { gate: 'x' }),
      ),
    ).toBe('SHIFT_NOT_FOUND');

    // A finished shift is history.
    clock('15:00');
    await as(guardUser).post('/security/shift/check-out');
    const finished = await admin.patch(`/admin/shifts/${shift.id}`, {
      endsAt: instant('17:00').toISOString(),
    });
    expect(errorCode(finished)).toBe('SHIFT_INVALID_STATE');
  });

  it('removes a shift, also after it was allotted and started, but never a finished one', async () => {
    const shift = await assigned('Morning');
    const removed = await admin.delete(`/admin/shifts/${shift.id}`);
    expect(removed.status).toBe(204);
    expect(await prisma.securityShift.count()).toBe(0);

    const started = await assigned('Morning');
    clock('08:30');
    await as(guardUser).post('/security/shift/check-in', {});
    // Started but nothing recorded yet: it can still be removed.
    expect((await admin.delete(`/admin/shifts/${started.id}`)).status).toBe(204);
    expect(await prisma.securityShift.count()).toBe(0);

    // A finished shift is a record.
    const finishedShift = await assigned('Evening');
    clock('16:30');
    await as(guardUser).post('/security/shift/check-in', {});
    await as(guardUser).post('/security/shift/check-out');
    expect(errorCode(await admin.delete(`/admin/shifts/${finishedShift.id}`))).toBe(
      'SHIFT_INVALID_STATE',
    );
    expect(
      errorCode(await admin.delete('/admin/shifts/00000000-0000-4000-8000-000000000000')),
    ).toBe('SHIFT_NOT_FOUND');
  });

  it('removes a guard: the account is deactivated and upcoming shifts go, but not while on duty', async () => {
    const shift = await assigned('Morning');
    clock('08:30');
    await as(guardUser).post('/security/shift/check-in', {});
    expect(errorCode(await admin.delete(`/admin/security-staff/${guardUser.id}`))).toBe(
      'SHIFT_INVALID_STATE',
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: guardUser.id } })).isActive).toBe(true);

    await as(guardUser).post('/security/shift/check-out');
    const evening = await assigned('Evening');
    const removed = await admin.delete(`/admin/security-staff/${guardUser.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ id: guardUser.id, isActive: false });
    expect(await prisma.securityShift.findUnique({ where: { id: evening.id } })).toBeNull();
    // The shift they worked stays on record.
    expect(await prisma.securityShift.findUnique({ where: { id: shift.id } })).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'SECURITY_STAFF_REMOVED' } })).toBe(1);
    expect(
      errorCode(await admin.delete('/admin/security-staff/00000000-0000-4000-8000-000000000000')),
    ).toBe('SECURITY_STAFF_NOT_FOUND');
  });

  it('keeps the shift history filterable', async () => {
    const second = (await signIn('SECURITY_STAFF', 'guard2', { onDuty: false })).user;
    await assigned('Morning');
    await assigned('Evening', second.id);
    await assigned('Night', guardUser.id, {}, NEXT_DAY);

    const page = async (query: Record<string, string | number>) =>
      (await admin.get('/admin/shifts', query)).body as Page<ShiftView>;
    expect((await page({})).total).toBe(3);
    expect((await page({ date: DAY })).items.map((s) => s.name).sort()).toEqual([
      'Evening',
      'Morning',
    ]);
    expect((await page({ staffId: second.id })).items.map((s) => s.name)).toEqual(['Evening']);
    expect((await page({ from: NEXT_DAY, to: NEXT_DAY })).items.map((s) => s.name)).toEqual([
      'Night',
    ]);
    expect((await page({ status: 'SCHEDULED' })).total).toBe(3);
    expect((await page({ status: 'ACTIVE' })).total).toBe(0);
    expect((await page({ page: 2, pageSize: 2 })).items).toHaveLength(1);
    expect((await admin.get('/admin/shifts', { from: NEXT_DAY, to: DAY })).status).toBe(400);
  });
});

describe('checking in and out', () => {
  it('shows the guard their shift context and walks through the whole day', async () => {
    const shift = await assigned('Morning');
    const guard = () => as(guardUser);

    // Before the check-in window opens there is nothing to check in to, but the shift is upcoming.
    clock('06:30');
    let mine = (await guard().get('/security/shift')).body as MyShiftResponse;
    expect(mine).toMatchObject({ onDuty: false, current: null, enforcement: 'required' });
    expect(mine.upcoming.map((s) => s.id)).toEqual([shift.id]);
    expect(errorCode(await guard().post('/security/shift/check-in', {}))).toBe('SHIFT_TOO_EARLY');

    // Arriving early (within the hour before the start) is allowed: CHECKED_IN, not yet on duty.
    clock('07:15');
    mine = (await guard().get('/security/shift')).body as MyShiftResponse;
    expect(mine.current).toMatchObject({ id: shift.id, status: 'SCHEDULED', onDuty: false });
    const early = await guard().post('/security/shift/check-in', {});
    expect(early.status).toBe(200);
    expect(early.body).toMatchObject({ status: 'CHECKED_IN', onDuty: false, flags: [] });

    // When the shift starts, the same shift reads ACTIVE and ON DUTY.
    clock('08:05');
    mine = (await guard().get('/security/shift')).body as MyShiftResponse;
    expect(mine).toMatchObject({
      onDuty: true,
      current: { id: shift.id, name: 'Morning', gate: 'Main Gate', status: 'ACTIVE', onDuty: true },
    });

    // Checking out ends duty and, since it is before the end, is flagged.
    clock('12:00');
    const out = await guard().post('/security/shift/check-out');
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      status: 'CHECKED_OUT',
      onDuty: false,
      flags: ['EARLY_CHECKOUT'],
      cashStatus: 'AWAITING_HANDOVER',
    });
    mine = (await guard().get('/security/shift')).body as MyShiftResponse;
    expect(mine).toMatchObject({ onDuty: false, current: null });

    const trail = (
      await prisma.auditLog.findMany({
        where: { entityId: shift.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(trail).toEqual(['SHIFT_ASSIGNED', 'SHIFT_CHECKED_IN', 'SHIFT_CHECKED_OUT']);
  });

  it('marks a late arrival, and a normal finish carries no flag', async () => {
    await assigned('Morning');
    clock('08:25');
    const late = await as(guardUser).post('/security/shift/check-in', {});
    expect(late.body).toMatchObject({ status: 'ACTIVE', flags: ['LATE'] });
    clock('15:55');
    const out = await as(guardUser).post('/security/shift/check-out');
    expect((out.body as ShiftView).flags).toEqual(['LATE']);
  });

  it('refuses a double check-in, a check-out with nothing open and somebody else’s shift', async () => {
    const mine = await assigned('Morning');
    const other = (await signIn('SECURITY_STAFF', 'guard2', { onDuty: false })).user;
    const theirs = await assigned('Morning', other.id);
    clock('08:10');
    expect(errorCode(await as(guardUser).post('/security/shift/check-out'))).toBe(
      'SHIFT_INVALID_STATE',
    );
    expect(
      errorCode(await as(guardUser).post('/security/shift/check-in', { shiftId: theirs.id })),
    ).toBe('SHIFT_NOT_FOUND');
    expect(
      (await as(guardUser).post('/security/shift/check-in', { shiftId: mine.id })).status,
    ).toBe(200);
    expect(errorCode(await as(guardUser).post('/security/shift/check-in', {}))).toBe(
      'SHIFT_INVALID_STATE',
    );
    expect((await as(other).post('/security/shift/check-in', {})).status).toBe(200);
  });

  it('settles a forgotten check-out when the next shift begins or when the grace period passes', async () => {
    const morning = await assigned('Morning');
    const evening = await assigned('Evening');
    clock('08:00');
    await as(guardUser).post('/security/shift/check-in', {});

    // Still inside the morning shift: the guard has to check out first.
    clock('15:50');
    expect(
      errorCode(await as(guardUser).post('/security/shift/check-in', { shiftId: evening.id })),
    ).toBe('SHIFT_INVALID_STATE');

    // After the morning shift ended, checking in to the evening shift closes the morning one at its scheduled end.
    clock('16:05');
    const next = await as(guardUser).post('/security/shift/check-in', {});
    expect(next.status).toBe(200);
    expect(next.body).toMatchObject({ id: evening.id, status: 'ACTIVE' });
    const closed = await prisma.securityShift.findUniqueOrThrow({ where: { id: morning.id } });
    expect(closed).toMatchObject({ status: 'CHECKED_OUT' });
    expect(closed.checkedOutAt?.toISOString()).toBe(instant('16:00').toISOString());
    expect(flagsOf(closed)).toEqual([]); // not an early check-out

    // A shift left open past the grace period is checked out by the sweep.
    clock('23:59');
    const sweep = await admin.get('/admin/shifts', { date: DAY, status: 'CHECKED_OUT' });
    expect((sweep.body as Page<ShiftView>).total).toBe(1);
    clock('00:45', NEXT_DAY);
    const swept = (await admin.get('/admin/shifts', { date: DAY, status: 'CHECKED_OUT' }))
      .body as Page<ShiftView>;
    expect(swept.items.map((s) => s.name).sort()).toEqual(['Evening', 'Morning']);
    const evenings = await prisma.securityShift.findUniqueOrThrow({ where: { id: evening.id } });
    expect(evenings.checkedOutAt?.toISOString()).toBe(instant('00:00', NEXT_DAY).toISOString());
  });

  it('marks a shift nobody checked in to as MISSED and tells the administrators', async () => {
    const shift = await assigned('Morning');
    clock('17:00');
    const view = (await admin.get(`/admin/shifts/${shift.id}`)).body as ShiftView;
    expect(view.status).toBe('MISSED');
    expect((await prisma.securityShift.findUniqueOrThrow({ where: { id: shift.id } })).status).toBe(
      'MISSED',
    );

    const notices = (await admin.get('/notifications')).body as NotificationsResponse;
    expect(notices.items.map((n) => n.kind)).toContain('SHIFT_MISSED');
    expect(notices.items.find((n) => n.kind === 'SHIFT_MISSED')?.params).toMatchObject({
      staffName: 'SECURITY_STAFF user',
      shiftName: 'Morning',
      date: DAY,
    });
    // Sweeping again changes nothing, and the missed shift can no longer be checked in to.
    await admin.get('/admin/shifts');
    expect(await prisma.auditLog.count({ where: { action: 'SHIFT_MISSED' } })).toBe(1);
    expect(
      errorCode(await as(guardUser).post('/security/shift/check-in', { shiftId: shift.id })),
    ).toBe('SHIFT_INVALID_STATE');
    // …and its slot in the roster can be given to someone else.
    clock('06:00', NEXT_DAY);
    expect((await assign('Morning', guardUser.id, {}, NEXT_DAY)).status).toBe(201);
  });

  it('is for Security Staff only', async () => {
    const student = await createParkingUser();
    for (const [method, path] of [
      ['get', '/security/shift'],
      ['post', '/security/shift/check-in'],
      ['post', '/security/shift/check-out'],
    ] as const) {
      expect((await admin[method](path)).status, `admin ${path}`).toBe(403);
      expect((await client(app, student.token)[method](path)).status, `student ${path}`).toBe(403);
      expect((await client(app)[method](path)).status, `anonymous ${path}`).toBe(401);
    }
  });
});

describe('gate operations need an on-duty shift', () => {
  const entry = (token: string) =>
    client(app, token).post('/parking/check-ins', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 9,
    });
  const token = () => tokenService.issueAccessToken(guardUser.id, guardUser.tokenVersion).token;

  it('turns a guard away without a checked-in shift, and lets them work once on duty', async () => {
    await assigned('Morning');
    clock('09:00');
    const before = await entry(token());
    expect(before.status).toBe(403);
    expect(errorCode(before)).toBe('SHIFT_REQUIRED');
    // Looking things up needs no shift.
    expect((await parkingApi(app, token()).map()).status).toBe(200);

    await as(guardUser).post('/security/shift/check-in', {});
    const after = await entry(token());
    expect(after.status).toBe(201);
    expect((after.body as CheckInResponse).session.slotCode).toBe('T-01');
  });

  it('does not count an early check-in as being on duty before the shift starts', async () => {
    await assigned('Morning');
    clock('07:30');
    await as(guardUser).post('/security/shift/check-in', {});
    expect(errorCode(await entry(token()))).toBe('SHIFT_REQUIRED');
    clock('08:00');
    expect((await entry(token())).status).toBe(201);
  });

  it('stops a guard whose shift has run past its end, until an administrator extends it', async () => {
    const shift = await assigned('Morning');
    clock('09:00');
    await as(guardUser).post('/security/shift/check-in', {});
    clock('16:20'); // inside the grace period: still fine
    expect((await entry(token())).status).toBe(201);

    clock('16:40'); // past it
    const ended = await client(app, token()).post('/parking/payments', {
      sessionNumber: 'CPVTS-P-00000000',
      exitHour: 12,
      method: 'UPI',
    });
    expect(errorCode(ended)).toBe('SHIFT_ENDED');
    const refused = await client(app, token()).post('/parking/check-ins', {
      vehicleNumber: 'KA01CD5678',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 9,
    });
    expect(errorCode(refused)).toBe('SHIFT_ENDED');

    const extended = await admin.patch(`/admin/shifts/${shift.id}`, {
      endsAt: instant('18:00').toISOString(),
    });
    expect(extended.status).toBe(200);
    clock('16:45');
    const ok = await client(app, token()).post('/parking/check-ins', {
      vehicleNumber: 'KA01CD5678',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 9,
    });
    expect(ok.status).toBe(201);
  });

  it('attributes a checkout to the guard, the shift and the gate', async () => {
    const shift = await assigned('Morning');
    clock('09:00');
    await as(guardUser).post('/security/shift/check-in', {});
    const guard = parkingApi(app, token());
    const parked = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 9);
    const done = await guard.checkOutOk(parked.session.sessionNumber, 12, 'CASH');
    expect(done.payment).toMatchObject({ status: 'PAID', method: 'CASH', amountPaise: 6000 });

    const payment = await prisma.payment.findFirstOrThrow({ include: { shift: true } });
    expect(payment).toMatchObject({ processedById: guardUser.id, shiftId: shift.id });
    expect(payment.shift?.gate).toBe('Main Gate');
    const finalized = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'TRANSACTION_FINALIZED' },
    });
    expect(finalized.metadata).toMatchObject({ shiftId: shift.id });
    const session = await prisma.parkingSession.findFirstOrThrow();
    expect(session.checkedOutById).toBe(guardUser.id);
  });

  it('never breaks a transaction already under way when the shift ends', async () => {
    const shift = await assigned('Morning');
    clock('15:00');
    await as(guardUser).post('/security/shift/check-in', {});
    const guard = parkingApi(app, token());
    const parked = await guard.checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 9);
    const sessionNumber = parked.session.sessionNumber;
    const created = (await guard.createPayment({ sessionNumber, exitHour: 15, method: 'CASH' }))
      .body as { payment: { id: string } };

    // The guard checks out; later the customer finally pays.
    clock('15:58');
    await as(guardUser).post('/security/shift/check-out');
    clock('16:20');
    const done = await guard.process(created.payment.id, { sessionNumber });
    expect(done.status).toBe(200);
    expect(
      await prisma.payment.findUniqueOrThrow({ where: { id: created.payment.id } }),
    ).toMatchObject({
      status: 'PAID',
      shiftId: shift.id,
      processedById: guardUser.id,
    });

    // But a new payment needs a new shift.
    const second = await guard
      .checkInOk('KA01CD5678', 'TWO_WHEELER', 'VISITOR', 9)
      .catch((e: Error) => e);
    expect(second).toBeInstanceOf(Error); // vehicle entry is closed too
    expect(
      errorCode(await guard.createPayment({ sessionNumber, exitHour: 15, method: 'UPI' })),
    ).toBe('SHIFT_REQUIRED');
  });

  it('lets an administrator act without a shift, as an override', async () => {
    const parked = await (async () => {
      await assigned('Morning');
      clock('09:00');
      await as(guardUser).post('/security/shift/check-in', {});
      return parkingApi(app, token()).checkInOk('KA22AB1234', 'TWO_WHEELER', 'VISITOR', 9);
    })();
    const adminApi = parkingApi(
      app,
      tokenService.issueAccessToken(adminUser.id, adminUser.tokenVersion).token,
    );
    const done = await adminApi.checkOutOk(parked.session.sessionNumber, 12, 'UPI');
    expect(done.receipt?.totalPaise).toBe(6000);
    expect((await prisma.payment.findFirstOrThrow()).shiftId).toBeNull();
  });
});

describe('API errors', () => {
  it('use the standard envelope', async () => {
    const res = await client(
      app,
      tokenService.issueAccessToken(guardUser.id, guardUser.tokenVersion).token,
    ).post('/parking/check-ins', {
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'VISITOR',
      entryHour: 9,
    });
    const body = res.body as ApiErrorBody;
    expect(body.error.code).toBe('SHIFT_REQUIRED');
    expect(config.shifts.enforcement).toBe('required');
  });
});
