import { z } from 'zod';

import { passwordPolicySchema, USERNAME_MAX_LENGTH } from './auth.js';
import { campusDateSchema, paginationSchema } from './management.js';
import type { PaymentMethod } from './operations.js';
import { fullNameSchema } from './portal.js';
import { VALIDATION_MESSAGES } from './validation.js';

/**
 * Security Staff duty shifts and cash accountability. This is operational
 * gate-duty management — who is on duty, what they collected, whether the cash
 * they hand over matches — not HR, attendance or payroll.
 */

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema.optional());

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/**
 * SCHEDULED → (check in) → CHECKED_IN / ACTIVE → (check out) → CHECKED_OUT →
 * (cash handover reconciled) → CLOSED. `CHECKED_IN` is an early check-in before
 * the shift's start time; it becomes ACTIVE (on duty) when the shift starts.
 * `MISSED` is a shift nobody checked in to before it ended.
 */
export const SHIFT_STATUSES = [
  'SCHEDULED',
  'CHECKED_IN',
  'ACTIVE',
  'CHECKED_OUT',
  'CLOSED',
  'MISSED',
] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

/** Exceptions, derived from the timestamps (not separate states). */
export const SHIFT_FLAGS = ['LATE', 'EARLY_CHECKOUT'] as const;
export type ShiftFlag = (typeof SHIFT_FLAGS)[number];

/**
 * `required`: Security Staff need an active shift for gate operations (check-in,
 * checkout payments). `optional`: operations are allowed without one, and are
 * attributed to the staff member's active shift when they have one.
 */
export const SHIFT_ENFORCEMENT_MODES = ['required', 'optional'] as const;
export type ShiftEnforcement = (typeof SHIFT_ENFORCEMENT_MODES)[number];

/**
 * Where the cash of a shift stands:
 * NOT_DUE (shift still running or never worked) → AWAITING_HANDOVER (checked out, cash not
 * yet received) → DISCREPANCY (received, but it does not match and is unreviewed) →
 * RECONCILED (matched, or the difference was reviewed). Only RECONCILED shifts are CLOSED.
 */
export const CASH_STATUSES = ['NOT_DUE', 'AWAITING_HANDOVER', 'DISCREPANCY', 'RECONCILED'] as const;
export type CashStatus = (typeof CASH_STATUSES)[number];

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------

export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const timeOfDaySchema = z
  .string({ error: VALIDATION_MESSAGES.required })
  .trim()
  .regex(TIME_OF_DAY_PATTERN, { error: VALIDATION_MESSAGES.invalidTime });

/** Minutes after midnight → "08:00". */
export const formatTimeOfDay = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** "16:00" → 960, or null if it is not a time of day. */
export const parseTimeOfDay = (value: string): number | null => {
  if (!TIME_OF_DAY_PATTERN.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
};

/** Length of a shift between two times of day; an end at or before the start crosses midnight. */
export const shiftDurationMinutes = (startMinute: number, endMinute: number): number =>
  endMinute > startMinute ? endMinute - startMinute : 24 * 60 - startMinute + endMinute;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const shiftNameSchema = z
  .string({ error: VALIDATION_MESSAGES.required })
  .trim()
  .min(1, { error: VALIDATION_MESSAGES.required })
  .max(60, { error: VALIDATION_MESSAGES.tooLong });

const noteSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: VALIDATION_MESSAGES.tooLong })
    .transform((value) => (value === '' ? null : value))
    .nullable();

/** 00:00–08:00 style templates; Admin can create and edit any number of them. */
export const createShiftTemplateRequestSchema = z
  .object({
    name: shiftNameSchema,
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
  })
  .refine((value) => value.startTime !== value.endTime, {
    path: ['endTime'],
    error: VALIDATION_MESSAGES.shiftTimesEqual,
  });
export type CreateShiftTemplateRequest = z.input<typeof createShiftTemplateRequestSchema>;

/** Editing a template never changes shifts already assigned from it. */
export const updateShiftTemplateRequestSchema = z
  .object({
    name: shiftNameSchema.optional(),
    startTime: timeOfDaySchema.optional(),
    endTime: timeOfDaySchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: VALIDATION_MESSAGES.nothingToUpdate,
  });
export type UpdateShiftTemplateRequest = z.input<typeof updateShiftTemplateRequestSchema>;

/** Assigns a Security Staff member to a template's shift on a campus date. */
export const createShiftRequestSchema = z.object({
  staffId: z.uuid({ error: VALIDATION_MESSAGES.required }),
  date: campusDateSchema,
  templateId: z.uuid({ error: VALIDATION_MESSAGES.required }),
  gate: noteSchema(60).optional(),
  note: noteSchema(255).optional(),
});
export type CreateShiftRequest = z.input<typeof createShiftRequestSchema>;

/** Administrator corrections: gate, note, and the shift's window (extend or correct). */
export const updateShiftRequestSchema = z
  .object({
    gate: noteSchema(60).optional(),
    note: noteSchema(255).optional(),
    startsAt: z.iso.datetime({ offset: true, error: VALIDATION_MESSAGES.invalidDate }).optional(),
    endsAt: z.iso.datetime({ offset: true, error: VALIDATION_MESSAGES.invalidDate }).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: VALIDATION_MESSAGES.nothingToUpdate,
  });
export type UpdateShiftRequest = z.input<typeof updateShiftRequestSchema>;

const rangeIsOrdered = (value: { from?: string; to?: string }) =>
  !value.from || !value.to || value.from <= value.to;

export const shiftListQuerySchema = paginationSchema
  .extend({
    /** A single campus date (the daily roster). */
    date: optional(campusDateSchema),
    from: optional(campusDateSchema),
    to: optional(campusDateSchema),
    staffId: optional(z.uuid()),
    status: optional(z.enum(SHIFT_STATUSES)),
    cash: optional(z.enum(CASH_STATUSES)),
  })
  .refine(rangeIsOrdered, { path: ['to'], error: VALIDATION_MESSAGES.invalidDateRange });
export type ShiftListQuery = z.input<typeof shiftListQuerySchema>;

export const rosterQuerySchema = z.object({ date: optional(campusDateSchema) });

/** Used by the check-in screen when a guard has more than one shift to choose from. */
export const checkInShiftRequestSchema = z.object({ shiftId: z.uuid().optional() });
export type CheckInShiftRequest = z.input<typeof checkInShiftRequestSchema>;

/** The most cash a single handover can record (₹10,00,000). */
export const MAX_HANDOVER_PAISE = 100_000_000;

/**
 * The administrator counts what the guard hands over. When it differs from the
 * system's expected cash, a reason is mandatory (the server checks this against
 * the expected figure it computes itself).
 */
export const cashHandoverRequestSchema = z.object({
  actualCashPaise: z
    .number({ error: VALIDATION_MESSAGES.outOfRange })
    .int({ error: VALIDATION_MESSAGES.outOfRange })
    .min(0, { error: VALIDATION_MESSAGES.outOfRange })
    .max(MAX_HANDOVER_PAISE, { error: VALIDATION_MESSAGES.outOfRange }),
  note: z
    .string()
    .trim()
    .max(500, { error: VALIDATION_MESSAGES.tooLong })
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type CashHandoverRequest = z.input<typeof cashHandoverRequestSchema>;

export const resolveDiscrepancyRequestSchema = z.object({
  note: z
    .string({ error: VALIDATION_MESSAGES.required })
    .trim()
    .min(1, { error: VALIDATION_MESSAGES.required })
    .max(500, { error: VALIDATION_MESSAGES.tooLong }),
});
export type ResolveDiscrepancyRequest = z.input<typeof resolveDiscrepancyRequestSchema>;

export const cashSummaryQuerySchema = z
  .object({ from: optional(campusDateSchema), to: optional(campusDateSchema) })
  .refine(rangeIsOrdered, { path: ['to'], error: VALIDATION_MESSAGES.invalidDateRange });
export type CashSummaryQuery = z.input<typeof cashSummaryQuerySchema>;

// ---------------------------------------------------------------------------
// Security Staff accounts
// ---------------------------------------------------------------------------

/** Administrators create the gate accounts; Security Staff cannot register themselves. */
export const createSecurityStaffRequestSchema = z.object({
  username: z
    .string({ error: VALIDATION_MESSAGES.required })
    .trim()
    .toLowerCase()
    .min(3, { error: VALIDATION_MESSAGES.required })
    .max(USERNAME_MAX_LENGTH, { error: VALIDATION_MESSAGES.tooLong })
    .regex(/^[a-z0-9][a-z0-9._-]*$/, { error: VALIDATION_MESSAGES.required }),
  fullName: fullNameSchema,
  password: passwordPolicySchema,
});
export type CreateSecurityStaffRequest = z.input<typeof createSecurityStaffRequestSchema>;

export const resetPasswordRequestSchema = z.object({ password: passwordPolicySchema });
export type ResetPasswordRequest = z.input<typeof resetPasswordRequestSchema>;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface ShiftTemplateView {
  id: string;
  name: string;
  /** "08:00" (campus time). */
  startTime: string;
  endTime: string;
  /** True for shifts like 22:00–06:00 that end the next day. */
  crossesMidnight: boolean;
  durationMinutes: number;
  isActive: boolean;
}

export interface PersonRef {
  id: string;
  fullName: string;
}

export interface SecurityStaffRef extends PersonRef {
  username: string;
}

export interface SecurityStaffMember extends SecurityStaffRef {
  isActive: boolean;
  lastLoginAt: string | null;
  /** The shift this person is on duty for right now, if any. */
  onDutyShift: { id: string; name: string; endsAt: string; gate: string | null } | null;
}

/**
 * What a shift collected. Cash and digital collections are kept apart; payments are
 * simulated, so nothing here claims actual bank settlement.
 */
export interface ShiftCashSummary {
  /** Finalized (PAID) payments attributed to the shift, including ₹0 no-charge ones. */
  transactions: number;
  cashTransactions: number;
  /** Cash the guard must hand over. */
  expectedCashPaise: number;
  digitalTransactions: number;
  upiPaise: number;
  cardPaise: number;
  digitalPaise: number;
  noChargeTransactions: number;
  /** Cash + digital. */
  totalPaise: number;
  /** Payments created in the shift and not yet finished (PENDING / PROCESSING). */
  openPayments: number;
}

/** One finalized payment of a shift, for counting the cash drawer against the system. */
export interface ShiftTransactionView {
  transactionId: string;
  method: PaymentMethod;
  amountPaise: number;
  paidAt: string;
  sessionNumber: string;
  vehicleNumber: string;
  receiptNumber: string | null;
}

export interface CashHandoverView {
  expectedCashPaise: number;
  actualCashPaise: number;
  /** actual − expected: negative is short, positive is over, zero is balanced. */
  differencePaise: number;
  cashTransactions: number;
  digitalPaise: number;
  note: string | null;
  receivedBy: PersonRef;
  receivedAt: string;
  /** Present once an administrator has reviewed a mismatch. */
  resolution: { note: string; resolvedBy: PersonRef; resolvedAt: string } | null;
}

export interface ShiftView {
  id: string;
  staff: SecurityStaffRef;
  templateId: string | null;
  name: string;
  /** Campus date the shift starts on (YYYY-MM-DD). */
  date: string;
  startsAt: string;
  endsAt: string;
  gate: string | null;
  /** The effective status: an early CHECKED_IN shift reads ACTIVE once its start time has passed. */
  status: ShiftStatus;
  /** On duty right now: checked in, started, not checked out. */
  onDuty: boolean;
  flags: ShiftFlag[];
  checkedInAt: string | null;
  checkedOutAt: string | null;
  closedAt: string | null;
  note: string | null;
  cash: ShiftCashSummary;
  cashStatus: CashStatus;
  handover: CashHandoverView | null;
}

/** "Security 1 · 08:00–16:00 · Main Gate · ON DUTY" for the signed-in Security Staff member. */
export interface MyShiftResponse {
  onDuty: boolean;
  /** The shift on duty now, otherwise the one that can be checked in to, otherwise null. */
  current: ShiftView | null;
  /** Their later shifts (today and tomorrow). */
  upcoming: ShiftView[];
  enforcement: ShiftEnforcement;
}

export interface RosterResponse {
  date: string;
  templates: ShiftTemplateView[];
  shifts: ShiftView[];
  /** Active Security Staff without any shift that day. */
  unassignedStaff: SecurityStaffRef[];
}

export interface CashSummaryResponse {
  from: string;
  to: string;
  totals: {
    /** Cash the system recorded for shifts in the range. */
    expectedCashPaise: number;
    /** Cash administrators actually received for those shifts. */
    receivedCashPaise: number;
    digitalPaise: number;
    /** Net of all recorded differences that are not yet reviewed. */
    unresolvedDifferencePaise: number;
  };
  /**
   * Cash taken by Security Staff outside any shift (possible only while shifts are optional).
   * It belongs to no shift's handover, so it is reported here instead of disappearing.
   */
  unattributedCash: { transactions: number; amountPaise: number };
  /** Cash an administrator took directly (an override) — nobody hands it over. */
  administratorCash: { transactions: number; amountPaise: number };
  /** Checked-out shifts whose cash has not been received yet. */
  awaitingHandover: ShiftView[];
  /** Handovers that did not match and have not been reviewed. */
  openDiscrepancies: ShiftView[];
}
