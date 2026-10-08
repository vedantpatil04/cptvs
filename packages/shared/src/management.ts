import { z } from 'zod';

import { AUDIT_ACTION_CODES, AUDIT_ENTITY_TYPE_CODES, type AuditAction } from './audit.js';
import {
  normalizeVehicleNumber,
  slotCodeSchema,
  type Coordinates,
  type ParkingMapOccupant,
  type ParkingSessionStatus,
  type PaymentMethod,
  type PaymentStatus,
  type SlotCounts,
  type SlotStatus,
} from './operations.js';
import {
  OWNER_CATEGORIES,
  slotCodeMatchesVehicleType,
  VEHICLE_TYPES,
  type OwnerCategory,
  type VehicleType,
} from './parking.js';
import type { UserRole } from './roles.js';
import { VALIDATION_MESSAGES } from './validation.js';

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Treats empty query-string values as absent. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema.optional());

/** Campus calendar date, YYYY-MM-DD. */
export const CAMPUS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isCalendarDate = (value: string): boolean => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

export const campusDateSchema = z
  .string()
  .regex(CAMPUS_DATE_PATTERN, { error: VALIDATION_MESSAGES.invalidDate })
  .refine(isCalendarDate, { error: VALIDATION_MESSAGES.invalidDate });

/** Longest range accepted by history, reports and audit queries. */
export const MAX_RANGE_DAYS = 366;

const dateRange = {
  from: optional(campusDateSchema),
  to: optional(campusDateSchema),
};

const rangeIsOrdered = (value: { from?: string; to?: string }) =>
  !value.from || !value.to || value.from <= value.to;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Parking history (Master Blueprint §24)
// ---------------------------------------------------------------------------

const historyFilters = {
  /** Partial, normalised vehicle number. */
  vehicleNumber: optional(z.string().trim().max(20).transform(normalizeVehicleNumber)),
  slotCode: optional(z.string().trim().toUpperCase().max(32)),
  vehicleType: optional(z.enum(VEHICLE_TYPES)),
  ownerCategory: optional(z.enum(OWNER_CATEGORIES)),
  status: optional(z.enum(['ACTIVE', 'COMPLETED'])),
  ...dateRange,
};

export const historyFilterSchema = z
  .object(historyFilters)
  .refine(rangeIsOrdered, { path: ['to'], error: VALIDATION_MESSAGES.invalidDateRange });

export const historyQuerySchema = paginationSchema
  .extend(historyFilters)
  .refine(rangeIsOrdered, { path: ['to'], error: VALIDATION_MESSAGES.invalidDateRange });

export type HistoryFilters = z.infer<typeof historyFilterSchema>;
export type HistoryQuery = z.input<typeof historyQuerySchema>;

export interface HistoryItem {
  sessionNumber: string;
  status: ParkingSessionStatus;
  vehicleNumber: string;
  vehicleType: VehicleType;
  ownerCategory: OwnerCategory;
  blockName: string;
  slotCode: string;
  entryHour: number;
  exitHour: number | null;
  durationHours: number | null;
  /** Final fee from the finalized transaction (null while active). */
  feePaise: number | null;
  receiptNumber: string | null;
  transactionId: string | null;
  paymentStatus: PaymentStatus | null;
  entryAt: string;
  /** Transaction (finalization) time for completed sessions. */
  exitAt: string | null;
}

// ---------------------------------------------------------------------------
// Reports / CSV (Master Blueprint §43)
// ---------------------------------------------------------------------------

export const REPORT_KINDS = ['history', 'transactions', 'revenue', 'vehicles'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const reportQuerySchema = z
  .object(dateRange)
  .refine(rangeIsOrdered, { path: ['to'], error: VALIDATION_MESSAGES.invalidDateRange });

// ---------------------------------------------------------------------------
// Analytics (Master Blueprint §25)
// ---------------------------------------------------------------------------

export const analyticsQuerySchema = z.object({ date: optional(campusDateSchema) });

export interface ZoneUsage {
  code: string;
  name: string;
  vehicleType: VehicleType;
  totalSlots: number;
  /** Slots that can be used (not blocked) right now. */
  usableSlots: number;
  /** Sessions that started in this zone on the date. */
  sessions: number;
  peakOccupied: number;
  peakOccupancyPercent: number;
  currentOccupied: number;
  currentOccupancyPercent: number;
}

export interface AnalyticsResponse {
  /** Campus date analysed (YYYY-MM-DD). */
  date: string;
  generatedAt: string;
  /** Vehicles parked during each whole hour of the date, by vehicle type. */
  occupancyByHour: { hour: number; TWO_WHEELER: number; FOUR_WHEELER: number }[];
  entriesByHour: { hour: number; count: number }[];
  peakEntryHour: number | null;
  sessions: { entered: number; completed: number; averageDurationHours: number | null };
  /** From receipts issued on the date (finalized transactions only). */
  revenue: {
    totalPaise: number;
    transactions: number;
    byVehicleType: Record<VehicleType, number>;
    byOwnerCategory: Record<OwnerCategory, number>;
  };
  zones: ZoneUsage[];
  topSlots: { slotCode: string; zoneName: string; sessions: number }[];
}

// ---------------------------------------------------------------------------
// Alerts (Master Blueprint §26) — rule-based only
// ---------------------------------------------------------------------------

export type AlertKind = 'ZONE_FULL' | 'ZONE_NEARLY_FULL' | 'LONG_DURATION' | 'SLOT_BLOCKED';
export type AlertSeverity = 'critical' | 'warning' | 'info';

export type ParkingAlert =
  | {
      kind: 'ZONE_FULL' | 'ZONE_NEARLY_FULL';
      severity: AlertSeverity;
      zone: {
        code: string;
        name: string;
        vehicleType: VehicleType;
        occupied: number;
        usable: number;
        percent: number;
        availableSlots: string[];
      };
    }
  | {
      kind: 'LONG_DURATION';
      severity: AlertSeverity;
      session: {
        sessionNumber: string;
        vehicleNumber: string;
        slotCode: string;
        durationHours: number;
      };
    }
  | {
      kind: 'SLOT_BLOCKED';
      severity: AlertSeverity;
      slot: { code: string; zoneName: string; reason: string | null };
    };

export interface AlertsResponse {
  generatedAt: string;
  thresholds: { nearlyFullPercent: number; longDurationHours: number };
  alerts: ParkingAlert[];
}

// ---------------------------------------------------------------------------
// Parking Integrity Engine (Master Blueprint §18)
// ---------------------------------------------------------------------------

export const INTEGRITY_CHECKS = [
  'OCCUPIED_SLOT_HAS_ACTIVE_SESSION',
  'ACTIVE_SESSION_SLOT_OCCUPIED',
  'ONE_ACTIVE_SESSION_PER_VEHICLE',
  'NO_EXPIRED_SLOT_HOLDS',
  'COMPLETED_SESSION_HAS_RECEIPT',
  'PAID_PAYMENT_HAS_RECEIPT',
  'RECEIPT_MATCHES_TRANSACTION',
  'NO_STUCK_PAYMENTS',
] as const;
export type IntegrityCheckCode = (typeof INTEGRITY_CHECKS)[number];

export interface IntegrityReport {
  checkedAt: string;
  healthy: boolean;
  checks: { code: IntegrityCheckCode; passed: boolean; findings: string[] }[];
  /** Most recent operations refused by an integrity rule. */
  recentRejections: {
    at: string;
    code: string;
    actor: string | null;
    entityType: string | null;
    entityId: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Session timeline / audit replay (Master Blueprint §19)
// ---------------------------------------------------------------------------

export type TimelineDetails = Partial<{
  slotCode: string;
  score: number;
  vehicleNumber: string;
  entryHour: number;
  exitHour: number;
  durationHours: number;
  amountPaise: number;
  method: PaymentMethod;
  transactionId: string;
  receiptNumber: string;
  reason: string;
}>;

/** Who performed a step: the security desk, the owner (self-service), a visitor, or the system. */
export type TimelineChannel = 'SECURITY' | 'SELF_SERVICE' | 'VISITOR' | 'SYSTEM';

export interface TimelineEvent {
  at: string;
  action: AuditAction;
  /** Null when the step was not performed by a named user, or when the viewer may not see who. */
  actor: { fullName: string; role: UserRole } | null;
  channel: TimelineChannel;
  details: TimelineDetails;
}

export interface SessionTimelineResponse {
  sessionNumber: string;
  events: TimelineEvent[];
}

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

export const auditLogQuerySchema = paginationSchema
  .extend({
    action: optional(z.enum(AUDIT_ACTION_CODES as [AuditAction, ...AuditAction[]])),
    entityType: optional(z.enum(AUDIT_ENTITY_TYPE_CODES as [string, ...string[]])),
    entityId: optional(z.string().trim().max(64)),
    actor: optional(z.string().trim().toLowerCase().max(64)),
    ...dateRange,
  })
  .refine(rangeIsOrdered, { path: ['to'], error: VALIDATION_MESSAGES.invalidDateRange });
export type AuditLogQuery = z.input<typeof auditLogQuerySchema>;

export interface AuditLogEntry {
  id: string;
  at: string;
  action: string;
  actor: { username: string; fullName: string; role: UserRole } | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
}

// ---------------------------------------------------------------------------
// Slot management (Master Blueprint §23)
// ---------------------------------------------------------------------------

export const blockSlotRequestSchema = z.object({
  reason: z
    .string({ error: VALIDATION_MESSAGES.required })
    .trim()
    .min(1, { error: VALIDATION_MESSAGES.required })
    .max(255, { error: VALIDATION_MESSAGES.tooLong }),
});

export const slotPriorityRequestSchema = z.object({
  priority: z
    .number({ error: VALIDATION_MESSAGES.outOfRange })
    .int({ error: VALIDATION_MESSAGES.outOfRange })
    .min(0, { error: VALIDATION_MESSAGES.outOfRange })
    .max(100, { error: VALIDATION_MESSAGES.outOfRange }),
});

/** Real, collected coordinates — or both null to remove them. Never invented. */
export const blockLocationRequestSchema = z
  .object({
    latitude: z
      .number({ error: VALIDATION_MESSAGES.outOfRange })
      .min(-90, { error: VALIDATION_MESSAGES.outOfRange })
      .max(90, { error: VALIDATION_MESSAGES.outOfRange })
      .nullable(),
    longitude: z
      .number({ error: VALIDATION_MESSAGES.outOfRange })
      .min(-180, { error: VALIDATION_MESSAGES.outOfRange })
      .max(180, { error: VALIDATION_MESSAGES.outOfRange })
      .nullable(),
  })
  .refine((value) => (value.latitude === null) === (value.longitude === null), {
    path: ['longitude'],
    error: VALIDATION_MESSAGES.coordinatesPaired,
  });

const priorityValue = z
  .number({ error: VALIDATION_MESSAGES.outOfRange })
  .int({ error: VALIDATION_MESSAGES.outOfRange })
  .min(0, { error: VALIDATION_MESSAGES.outOfRange })
  .max(100, { error: VALIDATION_MESSAGES.outOfRange });

const sortOrderValue = z
  .number({ error: VALIDATION_MESSAGES.outOfRange })
  .int({ error: VALIDATION_MESSAGES.outOfRange })
  .min(0, { error: VALIDATION_MESSAGES.outOfRange })
  .max(9999, { error: VALIDATION_MESSAGES.outOfRange });

const reasonValue = z
  .string({ error: VALIDATION_MESSAGES.required })
  .trim()
  .min(1, { error: VALIDATION_MESSAGES.required })
  .max(255, { error: VALIDATION_MESSAGES.tooLong });

/** Block and zone codes, e.g. BLOCK-2W or ZONE-LIB. */
export const INVENTORY_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,31}$/;
export const inventoryCodeSchema = z
  .string({ error: VALIDATION_MESSAGES.required })
  .trim()
  .toUpperCase()
  .regex(INVENTORY_CODE_PATTERN, { error: VALIDATION_MESSAGES.invalidInventoryCode });

const nameValue = z
  .string({ error: VALIDATION_MESSAGES.required })
  .trim()
  .min(1, { error: VALIDATION_MESSAGES.required })
  .max(120, { error: VALIDATION_MESSAGES.tooLong });

export const SLOT_INITIAL_STATUSES = ['AVAILABLE', 'BLOCKED'] as const;

/**
 * Adds a slot to a zone. The vehicle type must be the zone's type and the
 * slot ID must carry that type's prefix (T-… for two-wheelers, F-… for
 * four-wheelers); the server checks both against the stored zone. A new
 * AVAILABLE slot is picked up by the allocation engine immediately.
 */
export const createSlotRequestSchema = z
  .object({
    zoneCode: inventoryCodeSchema,
    vehicleType: z.enum(VEHICLE_TYPES, { error: VALIDATION_MESSAGES.selectOption }),
    code: slotCodeSchema,
    priority: priorityValue.default(0),
    status: z
      .enum(SLOT_INITIAL_STATUSES, { error: VALIDATION_MESSAGES.selectOption })
      .default('AVAILABLE'),
    blockedReason: reasonValue.optional(),
    /** Position in the zone's layout; defaults to the end. */
    sortOrder: sortOrderValue.optional(),
  })
  .refine((value) => slotCodeMatchesVehicleType(value.code, value.vehicleType), {
    path: ['code'],
    error: VALIDATION_MESSAGES.slotCodePrefix,
  })
  .refine((value) => value.status !== 'BLOCKED' || Boolean(value.blockedReason), {
    path: ['blockedReason'],
    error: VALIDATION_MESSAGES.required,
  });
export type CreateSlotRequest = z.input<typeof createSlotRequestSchema>;
/** The validated request with defaults applied (what the server works with). */
export type CreateSlotInput = z.output<typeof createSlotRequestSchema>;

/**
 * Edits a slot. `code` and `zoneCode` can change only while the slot has no
 * parking history (history keeps pointing at the slot); `blockedReason` only
 * while it is BLOCKED.
 */
export const updateSlotRequestSchema = z
  .object({
    code: slotCodeSchema.optional(),
    zoneCode: inventoryCodeSchema.optional(),
    priority: priorityValue.optional(),
    sortOrder: sortOrderValue.optional(),
    blockedReason: reasonValue.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: VALIDATION_MESSAGES.nothingToUpdate,
  });
export type UpdateSlotRequest = z.input<typeof updateSlotRequestSchema>;

export const layoutQuerySchema = z.object({
  includeArchived: z
    .preprocess((value) => value === true || value === 'true' || value === '1', z.boolean())
    .default(false),
});
export type LayoutQuery = z.input<typeof layoutQuerySchema>;

export const createBlockRequestSchema = z
  .object({
    code: inventoryCodeSchema,
    name: nameValue,
    description: z
      .string()
      .trim()
      .max(255, { error: VALIDATION_MESSAGES.tooLong })
      .nullable()
      .optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    sortOrder: sortOrderValue.optional(),
  })
  .refine((value) => ((value.latitude ?? null) === null) === ((value.longitude ?? null) === null), {
    path: ['longitude'],
    error: VALIDATION_MESSAGES.coordinatesPaired,
  });
export type CreateBlockRequest = z.input<typeof createBlockRequestSchema>;
export type CreateBlockInput = z.output<typeof createBlockRequestSchema>;

export const updateBlockRequestSchema = z
  .object({
    name: nameValue.optional(),
    description: z
      .string()
      .trim()
      .max(255, { error: VALIDATION_MESSAGES.tooLong })
      .nullable()
      .optional(),
    sortOrder: sortOrderValue.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: VALIDATION_MESSAGES.nothingToUpdate,
  });
export type UpdateBlockRequest = z.input<typeof updateBlockRequestSchema>;

export const createZoneRequestSchema = z.object({
  blockCode: inventoryCodeSchema,
  code: inventoryCodeSchema,
  name: nameValue,
  vehicleType: z.enum(VEHICLE_TYPES, { error: VALIDATION_MESSAGES.selectOption }),
  sortOrder: sortOrderValue.optional(),
});
export type CreateZoneRequest = z.input<typeof createZoneRequestSchema>;
export type CreateZoneInput = z.output<typeof createZoneRequestSchema>;

/** A zone's vehicle type can change only while it has no slots. */
export const updateZoneRequestSchema = z
  .object({
    name: nameValue.optional(),
    vehicleType: z.enum(VEHICLE_TYPES, { error: VALIDATION_MESSAGES.selectOption }).optional(),
    sortOrder: sortOrderValue.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: VALIDATION_MESSAGES.nothingToUpdate,
  });
export type UpdateZoneRequest = z.input<typeof updateZoneRequestSchema>;

export interface ManagedSlot {
  code: string;
  status: SlotStatus;
  priority: number;
  blockedReason: string | null;
  /** A disabled slot is out of service: never allocated, not counted as capacity. */
  isEnabled: boolean;
  /** Soft-deleted. Only listed when archived slots are requested. */
  archivedAt: string | null;
  sortOrder: number;
  /** When a temporary Park Now / allocation hold lapses (HELD slots only). */
  holdExpiresAt: string | null;
  /** True once any session used the slot: it can then be archived but not removed or renamed. */
  hasHistory: boolean;
  /** The vehicle parked in the slot (OCCUPIED slots only). */
  occupant: ParkingMapOccupant | null;
}

export interface ManagedZone {
  code: string;
  name: string;
  vehicleType: VehicleType;
  isActive: boolean;
  sortOrder: number;
  /** Enabled, non-archived slots only. */
  counts: SlotCounts;
  /** Slots that are out of service (disabled). */
  disabledSlots: number;
  slots: ManagedSlot[];
}

export interface ManagedBlock {
  code: string;
  name: string;
  description: string | null;
  coordinates: Coordinates | null;
  isActive: boolean;
  sortOrder: number;
  zones: ManagedZone[];
}

export interface ManagedLayout {
  blocks: ManagedBlock[];
}

/** Outcome of the safe delete: unused slots are removed, slots with history are archived. */
export interface SlotDeletionResult {
  outcome: 'DELETED' | 'ARCHIVED';
  code: string;
}
