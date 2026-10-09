import {
  parseTimeOfDay,
  type CreateShiftRequest,
  type CreateShiftTemplateRequest,
  type MyShiftResponse,
  type Page,
  type RosterResponse,
  type ShiftTemplateView,
  type ShiftView,
  type UpdateShiftRequest,
  type UpdateShiftTemplateRequest,
  type shiftListQuerySchema,
} from '@cpvts/shared';
import type { z } from 'zod';

import { config } from '../../config/index.js';
import { isUniqueViolation } from '../../db/errors.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma, SecurityShift } from '../../generated/prisma/client.js';
import { campusDateString } from '../../lib/campus-time.js';
import { badRequest } from '../../lib/errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { notificationService } from '../notifications/notification.service.js';
import type { OperationContext } from '../parking/operation-context.js';
import { loadCashSummaries } from './cash-summary.js';
import { shiftErrors } from './shift.errors.js';
import { isOnDuty, toTemplateView, windowFor } from './shift-policy.js';
import { loadShiftView, SHIFT_INCLUDE, toShiftViews } from './shift-views.js';

type ListQuery = z.output<typeof shiftListQuerySchema>;

/** Campus dates are stored as DATE columns: midnight UTC of the calendar date. */
const dateOnly = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

/** Serialises changes to one person's shifts, so two requests cannot create an overlap or double check-in. */
const lockStaff = (tx: Prisma.TransactionClient, staffId: string) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${staffId}, 0))::text AS locked`;

const audit = (
  tx: Prisma.TransactionClient,
  actorId: string | null,
  action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
  entityType: (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES],
  entityId: string,
  metadata: Prisma.InputJsonObject,
  context?: Pick<OperationContext, 'request'>,
) =>
  auditRepository.record(
    { action, actorId, entityType, entityId, metadata, request: context?.request },
    tx,
  );

const OPEN_STATUSES = ['CHECKED_IN', 'ACTIVE'] as const;

/** Whether the stored status filter matches the effective status the API shows. */
const statusWhere = (
  status: NonNullable<ListQuery['status']>,
  now: Date,
): Prisma.SecurityShiftWhereInput => {
  switch (status) {
    case 'ACTIVE':
      return {
        OR: [{ status: 'ACTIVE' }, { status: 'CHECKED_IN', startsAt: { lte: now } }],
      };
    case 'CHECKED_IN':
      return { status: 'CHECKED_IN', startsAt: { gt: now } };
    default:
      return { status };
  }
};

const cashWhere = (cash: NonNullable<ListQuery['cash']>): Prisma.SecurityShiftWhereInput => {
  switch (cash) {
    case 'NOT_DUE':
      return { status: { in: ['SCHEDULED', 'CHECKED_IN', 'ACTIVE', 'MISSED'] } };
    case 'AWAITING_HANDOVER':
      return { status: 'CHECKED_OUT', handover: { is: null } };
    case 'DISCREPANCY':
      return { handover: { is: { differencePaise: { not: 0 }, resolvedAt: null } } };
    case 'RECONCILED':
      return { status: 'CLOSED' };
    default: {
      const _exhaustive: never = cash;
      return {};
    }
  }
};

/**
 * Ends duty for an open shift (the guard checked out, an administrator did it for them, or
 * the shift ran past its end and was closed automatically at the scheduled end). Cash is not
 * settled here: the shift becomes CHECKED_OUT and waits for the handover.
 */
const finishShift = async (
  tx: Prisma.TransactionClient,
  shift: Pick<SecurityShift, 'id' | 'staffId' | 'shiftName' | 'shiftDate'>,
  at: Date,
  actorId: string | null,
  how: 'SELF' | 'ADMIN' | 'AUTO',
  context?: Pick<OperationContext, 'request'>,
): Promise<boolean> => {
  const { count } = await tx.securityShift.updateMany({
    where: { id: shift.id, status: { in: [...OPEN_STATUSES] } },
    data: { status: 'CHECKED_OUT', checkedOutAt: at },
  });
  if (count !== 1) return false;

  await audit(
    tx,
    actorId,
    AUDIT_ACTIONS.shiftCheckedOut,
    AUDIT_ENTITY_TYPES.securityShift,
    shift.id,
    { staffId: shift.staffId, how },
    context,
  );
  // Tell the cash custodian there is cash to collect from this guard.
  const summary = (await loadCashSummaries([shift.id], tx)).get(shift.id);
  if (summary && summary.expectedCashPaise > 0) {
    const staff = await tx.user.findUnique({
      where: { id: shift.staffId },
      select: { fullName: true },
    });
    await notificationService.notifyAdmins(
      'SHIFT_CASH_DUE',
      {
        staffName: staff?.fullName ?? '',
        shiftName: shift.shiftName,
        shiftId: shift.id,
        date: shift.shiftDate.toISOString().slice(0, 10),
        amountPaise: summary.expectedCashPaise,
      },
      tx,
    );
  }
  return true;
};

const mapTemplateNameViolation = (error: unknown): never => {
  if (isUniqueViolation(error, 'shift_templates_name_key')) throw shiftErrors.templateNameTaken();
  throw error;
};

/**
 * Security Staff duty shifts: templates, the daily roster, check-in / check-out and the
 * lookup that decides whether a guard is on duty. Operational gate duty only — not HR.
 */
export const shiftService = {
  // --- Templates -------------------------------------------------------------

  async listTemplates({ includeInactive = false } = {}): Promise<ShiftTemplateView[]> {
    const templates = await prisma.shiftTemplate.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ startMinute: 'asc' }, { name: 'asc' }],
    });
    return templates.map(toTemplateView);
  },

  async createTemplate(
    input: CreateShiftTemplateRequest,
    context: OperationContext,
  ): Promise<ShiftTemplateView> {
    const startMinute = parseTimeOfDay(input.startTime)!;
    const endMinute = parseTimeOfDay(input.endTime)!;
    try {
      return await withTransaction(async (tx) => {
        const clash = await tx.shiftTemplate.findFirst({
          where: { name: { equals: input.name.trim(), mode: 'insensitive' } },
          select: { id: true },
        });
        if (clash) throw shiftErrors.templateNameTaken();
        const created = await tx.shiftTemplate.create({
          data: { name: input.name.trim(), startMinute, endMinute },
        });
        await audit(
          tx,
          context.actor.id,
          AUDIT_ACTIONS.shiftTemplateCreated,
          AUDIT_ENTITY_TYPES.shiftTemplate,
          created.id,
          { name: created.name, startTime: input.startTime, endTime: input.endTime },
          context,
        );
        return toTemplateView(created);
      });
    } catch (error) {
      return mapTemplateNameViolation(error);
    }
  },

  /** Edits a template for the shifts assigned from now on; existing assignments keep their own copy. */
  async updateTemplate(
    id: string,
    patch: UpdateShiftTemplateRequest,
    context: OperationContext,
  ): Promise<ShiftTemplateView> {
    try {
      return await withTransaction(async (tx) => {
        const template = await tx.shiftTemplate.findUnique({ where: { id } });
        if (!template) throw shiftErrors.templateNotFound();

        const startMinute =
          patch.startTime !== undefined ? parseTimeOfDay(patch.startTime)! : template.startMinute;
        const endMinute =
          patch.endTime !== undefined ? parseTimeOfDay(patch.endTime)! : template.endMinute;
        if (startMinute === endMinute) {
          throw badRequest('A shift cannot start and end at the same time.');
        }
        if (patch.name !== undefined) {
          const clash = await tx.shiftTemplate.findFirst({
            where: { id: { not: id }, name: { equals: patch.name.trim(), mode: 'insensitive' } },
            select: { id: true },
          });
          if (clash) throw shiftErrors.templateNameTaken();
        }
        const updated = await tx.shiftTemplate.update({
          where: { id },
          data: {
            ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
            startMinute,
            endMinute,
            ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
          },
        });
        await audit(
          tx,
          context.actor.id,
          AUDIT_ACTIONS.shiftTemplateUpdated,
          AUDIT_ENTITY_TYPES.shiftTemplate,
          id,
          { fields: Object.keys(patch) },
          context,
        );
        return toTemplateView(updated);
      });
    } catch (error) {
      return mapTemplateNameViolation(error);
    }
  },

  // --- Administrator: assignments and the roster -------------------------------

  /** Assigns a Security Staff member to a template's shift on a campus date. */
  async assign(input: CreateShiftRequest, context: OperationContext): Promise<ShiftView> {
    const created = await withTransaction(async (tx) => {
      const staff = await tx.user.findFirst({
        where: { id: input.staffId, role: 'SECURITY_STAFF', isActive: true },
        select: { id: true, fullName: true },
      });
      if (!staff) throw shiftErrors.staffNotFound();
      const template = await tx.shiftTemplate.findFirst({
        where: { id: input.templateId, isActive: true },
      });
      if (!template) throw shiftErrors.templateNotFound();

      const { startsAt, endsAt } = windowFor(input.date, template.startMinute, template.endMinute);
      if (endsAt <= new Date()) {
        throw shiftErrors.invalidState('A shift that has already ended cannot be assigned.');
      }

      await lockStaff(tx, staff.id);
      const clash = await tx.securityShift.findFirst({
        where: {
          staffId: staff.id,
          status: { not: 'MISSED' },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { id: true },
      });
      if (clash) throw shiftErrors.conflict();

      const shift = await tx.securityShift.create({
        data: {
          staffId: staff.id,
          templateId: template.id,
          shiftName: template.name,
          shiftDate: dateOnly(input.date),
          startsAt,
          endsAt,
          gate: input.gate ?? null,
          note: input.note ?? null,
          createdById: context.actor.id,
        },
      });
      await audit(
        tx,
        context.actor.id,
        AUDIT_ACTIONS.shiftAssigned,
        AUDIT_ENTITY_TYPES.securityShift,
        shift.id,
        {
          staffId: staff.id,
          staffName: staff.fullName,
          shiftName: template.name,
          date: input.date,
          gate: input.gate ?? null,
        },
        context,
      );
      await notificationService.notify(
        staff.id,
        'SHIFT_ASSIGNED',
        { shiftName: template.name, shiftId: shift.id, date: input.date, gate: input.gate ?? '' },
        tx,
      );
      return shift;
    });
    return (await loadShiftView(created.id))!;
  },

  /** Corrects a shift: gate, note and — while it is open — its window (extend or correct). */
  async update(
    id: string,
    patch: UpdateShiftRequest,
    context: OperationContext,
  ): Promise<ShiftView> {
    await withTransaction(async (tx) => {
      const shift = await tx.securityShift.findUnique({ where: { id } });
      if (!shift) throw shiftErrors.notFound();

      const startsAt = patch.startsAt ? new Date(patch.startsAt) : shift.startsAt;
      const endsAt = patch.endsAt ? new Date(patch.endsAt) : shift.endsAt;
      // The time of a shift can be switched at any point until it is finished — before it starts
      // or while the guard is on duty — so the roster can follow reality.
      const open = ['SCHEDULED', 'CHECKED_IN', 'ACTIVE'].includes(shift.status);
      if ((patch.startsAt !== undefined || patch.endsAt !== undefined) && !open) {
        throw shiftErrors.invalidState('A finished shift can no longer be changed.');
      }
      if (endsAt <= startsAt) throw badRequest('A shift must end after it starts.');
      // A guard already on duty keeps a window that covers the present moment.
      if (shift.status !== 'SCHEDULED' && open) {
        const now = new Date();
        if (startsAt > now || endsAt <= now) {
          throw shiftErrors.invalidState(
            'A shift that is on duty must keep covering the current time.',
          );
        }
      }

      await lockStaff(tx, shift.staffId);
      if (patch.startsAt !== undefined || patch.endsAt !== undefined) {
        const clash = await tx.securityShift.findFirst({
          where: {
            id: { not: id },
            staffId: shift.staffId,
            status: { not: 'MISSED' },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { id: true },
        });
        if (clash) throw shiftErrors.conflict();
      }

      await tx.securityShift.update({
        where: { id },
        data: {
          ...(patch.gate !== undefined ? { gate: patch.gate } : {}),
          ...(patch.note !== undefined ? { note: patch.note } : {}),
          startsAt,
          endsAt,
        },
      });
      await audit(
        tx,
        context.actor.id,
        AUDIT_ACTIONS.shiftUpdated,
        AUDIT_ENTITY_TYPES.securityShift,
        id,
        {
          fields: Object.keys(patch),
          ...(patch.endsAt !== undefined
            ? { endsAt: { from: shift.endsAt.toISOString(), to: endsAt.toISOString() } }
            : {}),
          ...(patch.startsAt !== undefined
            ? { startsAt: { from: shift.startsAt.toISOString(), to: startsAt.toISOString() } }
            : {}),
        },
        context,
      );
    });
    return (await loadShiftView(id))!;
  },

  /**
   * Removes a shift, also after it was allotted and even while the guard is on duty, as long as it
   * has recorded nothing (no payments, no cash handover): then no history is lost. A shift that
   * handled money or is finished is a record and is ended, not removed.
   */
  async cancel(id: string, context: OperationContext): Promise<void> {
    await withTransaction(async (tx) => {
      const shift = await tx.securityShift.findUnique({ where: { id } });
      if (!shift) throw shiftErrors.notFound();
      if (!['SCHEDULED', 'CHECKED_IN', 'ACTIVE', 'MISSED'].includes(shift.status)) {
        throw shiftErrors.invalidState('A finished shift is a record and can not be removed.');
      }
      const [payments, handovers] = await Promise.all([
        tx.payment.count({ where: { shiftId: id } }),
        tx.cashHandover.count({ where: { shiftId: id } }),
      ]);
      if (payments > 0 || handovers > 0) {
        throw shiftErrors.invalidState(
          'This shift has recorded payments. End the shift instead of removing it.',
        );
      }
      const { count } = await tx.securityShift.deleteMany({
        where: { id, status: { in: ['SCHEDULED', 'CHECKED_IN', 'ACTIVE', 'MISSED'] } },
      });
      if (count !== 1) throw shiftErrors.invalidState();
      await audit(
        tx,
        context.actor.id,
        AUDIT_ACTIONS.shiftCancelled,
        AUDIT_ENTITY_TYPES.securityShift,
        id,
        {
          staffId: shift.staffId,
          shiftName: shift.shiftName,
          date: shift.shiftDate.toISOString().slice(0, 10),
        },
        context,
      );
    });
  },

  async get(id: string): Promise<ShiftView> {
    await this.sweep();
    const view = await loadShiftView(id);
    if (!view) throw shiftErrors.notFound();
    return view;
  },

  /** Shift history, filtered and paginated. */
  async list(query: ListQuery): Promise<Page<ShiftView>> {
    const now = new Date();
    await this.sweep(now);
    const where: Prisma.SecurityShiftWhereInput = {
      AND: [
        query.date ? { shiftDate: dateOnly(query.date) } : {},
        query.from || query.to
          ? {
              shiftDate: {
                ...(query.from ? { gte: dateOnly(query.from) } : {}),
                ...(query.to ? { lte: dateOnly(query.to) } : {}),
              },
            }
          : {},
        query.staffId ? { staffId: query.staffId } : {},
        query.status ? statusWhere(query.status, now) : {},
        query.cash ? cashWhere(query.cash) : {},
      ],
    };
    const [total, rows] = await Promise.all([
      prisma.securityShift.count({ where }),
      prisma.securityShift.findMany({
        where,
        include: SHIFT_INCLUDE,
        orderBy: [{ shiftDate: 'desc' }, { startsAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: await toShiftViews(rows, now),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  },

  /** The daily roster: the day's shifts, the templates to assign from and who has no shift. */
  async roster(date = campusDateString()): Promise<RosterResponse> {
    const now = new Date();
    await this.sweep(now);
    const [templates, rows, unassigned] = await Promise.all([
      prisma.shiftTemplate.findMany({
        where: { isActive: true },
        orderBy: [{ startMinute: 'asc' }, { name: 'asc' }],
      }),
      prisma.securityShift.findMany({
        where: { shiftDate: dateOnly(date) },
        include: SHIFT_INCLUDE,
        orderBy: [{ startsAt: 'asc' }, { staff: { fullName: 'asc' } }, { id: 'asc' }],
      }),
      prisma.user.findMany({
        where: {
          role: 'SECURITY_STAFF',
          isActive: true,
          shifts: { none: { shiftDate: dateOnly(date) } },
        },
        select: { id: true, fullName: true, username: true },
        orderBy: { fullName: 'asc' },
      }),
    ]);
    return {
      date,
      templates: templates.map(toTemplateView),
      shifts: await toShiftViews(rows, now),
      unassignedStaff: unassigned,
    };
  },

  // --- Security Staff: their own shift ---------------------------------------

  /** "Security 1 · 08:00–16:00 · Main Gate · ON DUTY": the signed-in guard's shift context. */
  async mine(staffId: string): Promise<MyShiftResponse> {
    const now = new Date();
    await this.sweep(now);
    const horizon = new Date(now.getTime() + 2 * 86_400_000);
    const rows = await prisma.securityShift.findMany({
      where: {
        staffId,
        OR: [
          { status: { in: [...OPEN_STATUSES] } },
          { status: 'SCHEDULED', endsAt: { gt: now }, startsAt: { lte: horizon } },
        ],
      },
      include: SHIFT_INCLUDE,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    const views = await toShiftViews(rows, now);
    const open = views.find((view) => view.status === 'ACTIVE' || view.status === 'CHECKED_IN');
    const checkInNow = views.find(
      (view) =>
        view.status === 'SCHEDULED' &&
        Date.parse(view.startsAt) - now.getTime() <= config.shifts.earlyCheckInMs,
    );
    const current = open ?? checkInNow ?? null;
    return {
      onDuty: Boolean(open?.onDuty),
      current,
      upcoming: views.filter((view) => view.id !== current?.id && view.status === 'SCHEDULED'),
      enforcement: config.shifts.enforcement,
    };
  },

  /**
   * Checks the guard in to their shift: the one given, otherwise the one whose check-in window
   * is open now. Starts duty immediately (ACTIVE), or CHECKED_IN if they arrive before the start.
   */
  async checkIn(
    staffId: string,
    shiftId: string | undefined,
    context: OperationContext,
  ): Promise<ShiftView> {
    const now = new Date();
    await this.sweep(now);
    const id = await withTransaction(async (tx) => {
      await lockStaff(tx, staffId);

      // A shift that ran past its end without a check-out is closed at its scheduled end.
      const expired = await tx.securityShift.findMany({
        where: { staffId, status: { in: [...OPEN_STATUSES] }, endsAt: { lte: now } },
      });
      for (const shift of expired) {
        await finishShift(tx, shift, shift.endsAt, null, 'AUTO');
      }
      const stillOpen = await tx.securityShift.findFirst({
        where: { staffId, status: { in: [...OPEN_STATUSES] } },
        select: { id: true },
      });
      if (stillOpen) {
        throw shiftErrors.invalidState('You are already checked in to a shift. Check out first.');
      }

      const earliest = new Date(now.getTime() + config.shifts.earlyCheckInMs);
      const candidate = shiftId
        ? await tx.securityShift.findFirst({ where: { id: shiftId, staffId } })
        : await tx.securityShift.findFirst({
            where: {
              staffId,
              status: 'SCHEDULED',
              endsAt: { gt: now },
              startsAt: { lte: earliest },
            },
            orderBy: { startsAt: 'asc' },
          });
      if (!candidate) {
        const upcoming = shiftId
          ? null
          : await tx.securityShift.findFirst({
              where: { staffId, status: 'SCHEDULED', endsAt: { gt: now } },
              select: { id: true },
            });
        throw upcoming ? shiftErrors.tooEarly() : shiftErrors.notFound();
      }
      if (candidate.status !== 'SCHEDULED') {
        throw shiftErrors.invalidState('You can only check in to a scheduled shift.');
      }
      if (candidate.endsAt <= now) {
        throw shiftErrors.invalidState(
          'This shift has already ended and can no longer be checked in to.',
        );
      }
      if (candidate.startsAt > earliest) throw shiftErrors.tooEarly();

      const { count } = await tx.securityShift.updateMany({
        where: { id: candidate.id, status: 'SCHEDULED' },
        data: { status: candidate.startsAt <= now ? 'ACTIVE' : 'CHECKED_IN', checkedInAt: now },
      });
      if (count !== 1) throw shiftErrors.invalidState();
      await audit(
        tx,
        context.actor.id,
        AUDIT_ACTIONS.shiftCheckedIn,
        AUDIT_ENTITY_TYPES.securityShift,
        candidate.id,
        { gate: candidate.gate, early: candidate.startsAt > now },
        context,
      );
      return candidate.id;
    });
    return (await loadShiftView(id))!;
  },

  /** The guard ends their duty. Payments still in progress are not interrupted. */
  async checkOut(staffId: string, context: OperationContext): Promise<ShiftView> {
    const id = await withTransaction(async (tx) => {
      await lockStaff(tx, staffId);
      const open = await tx.securityShift.findFirst({
        where: { staffId, status: { in: [...OPEN_STATUSES] } },
        orderBy: { startsAt: 'desc' },
      });
      if (!open) throw shiftErrors.invalidState('You are not checked in to a shift.');
      await finishShift(tx, open, new Date(), context.actor.id, 'SELF', context);
      return open.id;
    });
    return (await loadShiftView(id))!;
  },

  /** An administrator ends a shift the guard forgot to check out of. */
  async adminCheckOut(id: string, context: OperationContext): Promise<ShiftView> {
    await withTransaction(async (tx) => {
      const shift = await tx.securityShift.findUnique({ where: { id } });
      if (!shift) throw shiftErrors.notFound();
      await lockStaff(tx, shift.staffId);
      const done = await finishShift(tx, shift, new Date(), context.actor.id, 'ADMIN', context);
      if (!done) throw shiftErrors.invalidState('This shift is not on duty.');
    });
    return (await loadShiftView(id))!;
  },

  // --- Gate authorization ----------------------------------------------------------

  /**
   * The shift a guard's gate operations belong to right now: ON_DUTY (use it), ENDED (their
   * open shift ran past its end and the grace period) or NONE (nothing checked in, or an early
   * check-in whose start has not come yet).
   */
  async activeFor(
    staffId: string,
    now = new Date(),
  ): Promise<{ shift: SecurityShift | null; state: 'ON_DUTY' | 'ENDED' | 'NONE' }> {
    const shift = await prisma.securityShift.findFirst({
      where: { staffId, status: { in: [...OPEN_STATUSES] } },
      orderBy: { startsAt: 'desc' },
    });
    if (!shift) return { shift: null, state: 'NONE' };
    if (isOnDuty(shift, now)) return { shift, state: 'ON_DUTY' };
    return { shift, state: shift.startsAt > now ? 'NONE' : 'ENDED' };
  },

  // --- Housekeeping ----------------------------------------------------------------

  /**
   * Settles shifts the clock has overtaken, idempotently: a scheduled shift nobody checked in
   * to becomes MISSED (administrators are told), and an open shift past its end plus the grace
   * period is checked out at its scheduled end so its cash can be collected.
   */
  async sweep(now = new Date()): Promise<void> {
    const stale = await prisma.securityShift.findMany({
      where: { status: 'SCHEDULED', endsAt: { lte: now } },
      include: { staff: { select: { fullName: true } } },
    });
    for (const shift of stale) {
      const { count } = await prisma.securityShift.updateMany({
        where: { id: shift.id, status: 'SCHEDULED' },
        data: { status: 'MISSED' },
      });
      if (count !== 1) continue;
      await auditRepository.record({
        action: AUDIT_ACTIONS.shiftMissed,
        actorId: null,
        entityType: AUDIT_ENTITY_TYPES.securityShift,
        entityId: shift.id,
        metadata: { staffId: shift.staffId, shiftName: shift.shiftName },
      });
      await notificationService.notifyAdmins('SHIFT_MISSED', {
        staffName: shift.staff.fullName,
        shiftName: shift.shiftName,
        shiftId: shift.id,
        date: shift.shiftDate.toISOString().slice(0, 10),
        gate: shift.gate ?? '',
      });
    }

    const overdue = await prisma.securityShift.findMany({
      where: {
        status: { in: [...OPEN_STATUSES] },
        endsAt: { lte: new Date(now.getTime() - config.shifts.overrunMs) },
      },
    });
    for (const shift of overdue) {
      await withTransaction((tx) => finishShift(tx, shift, shift.endsAt, null, 'AUTO'));
    }
  },
};
