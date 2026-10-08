import {
  formatTimeOfDay,
  shiftDurationMinutes,
  type CashStatus,
  type ShiftFlag,
  type ShiftStatus,
  type ShiftTemplateView,
} from '@cpvts/shared';

import { config } from '../../config/index.js';
import { addCampusDays, campusInstant } from '../../lib/campus-time.js';

/**
 * Rules of the duty-shift state machine, kept free of database access.
 *
 *   SCHEDULED ──check in──► CHECKED_IN (early) / ACTIVE ──check out──► CHECKED_OUT ──cash
 *   handover reconciled──► CLOSED;  SCHEDULED past its end with nobody checked in ──► MISSED.
 */

/** A check-in later than this after the start is marked LATE. */
export const LATE_CHECK_IN_GRACE_MS = 10 * 60_000;
/** A check-out earlier than this before the end is marked EARLY_CHECKOUT. */
export const EARLY_CHECKOUT_GRACE_MS = 10 * 60_000;

/** The shift fields the policy reads. */
export interface ShiftTimes {
  status: ShiftStatus;
  startsAt: Date;
  endsAt: Date;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
}

/**
 * The status to show now. Two states are decided by the clock rather than by an action:
 * an early check-in becomes ACTIVE when the shift starts, and a shift nobody checked in to is
 * MISSED once it has ended (a background sweep also stores that).
 */
export const effectiveStatus = (shift: ShiftTimes, now = new Date()): ShiftStatus => {
  if (shift.status === 'CHECKED_IN' && shift.startsAt <= now) return 'ACTIVE';
  if (shift.status === 'SCHEDULED' && shift.endsAt <= now) return 'MISSED';
  return shift.status;
};

/** Checked in, started, and not past the end plus the grace period for finishing at the gate. */
export const isOnDuty = (shift: ShiftTimes, now = new Date()): boolean =>
  effectiveStatus(shift, now) === 'ACTIVE' &&
  shift.startsAt <= now &&
  now.getTime() <= shift.endsAt.getTime() + config.shifts.overrunMs;

/** Exceptions an administrator may care about, derived from the timestamps. */
export const flagsOf = (shift: ShiftTimes): ShiftFlag[] => {
  const flags: ShiftFlag[] = [];
  if (
    shift.checkedInAt &&
    shift.checkedInAt.getTime() > shift.startsAt.getTime() + LATE_CHECK_IN_GRACE_MS
  ) {
    flags.push('LATE');
  }
  if (
    shift.checkedOutAt &&
    shift.checkedOutAt.getTime() < shift.endsAt.getTime() - EARLY_CHECKOUT_GRACE_MS
  ) {
    flags.push('EARLY_CHECKOUT');
  }
  return flags;
};

/** Where the shift's cash stands (see `CASH_STATUSES`). */
export const cashStatusOf = (
  status: ShiftStatus,
  handover: { differencePaise: number; resolvedAt: Date | null } | null,
): CashStatus => {
  if (handover) {
    return handover.differencePaise !== 0 && handover.resolvedAt === null
      ? 'DISCREPANCY'
      : 'RECONCILED';
  }
  return status === 'CHECKED_OUT' ? 'AWAITING_HANDOVER' : 'NOT_DUE';
};

/** The instants a template's shift starts and ends on a campus date (an end at/before the start is next day). */
export const windowFor = (
  date: string,
  startMinute: number,
  endMinute: number,
): { startsAt: Date; endsAt: Date } => ({
  startsAt: campusInstant(date, startMinute),
  endsAt: campusInstant(endMinute > startMinute ? date : addCampusDays(date, 1), endMinute),
});

export const toTemplateView = (template: {
  id: string;
  name: string;
  startMinute: number;
  endMinute: number;
  isActive: boolean;
}): ShiftTemplateView => ({
  id: template.id,
  name: template.name,
  startTime: formatTimeOfDay(template.startMinute),
  endTime: formatTimeOfDay(template.endMinute),
  crossesMidnight: template.endMinute <= template.startMinute,
  durationMinutes: shiftDurationMinutes(template.startMinute, template.endMinute),
  isActive: template.isActive,
});
