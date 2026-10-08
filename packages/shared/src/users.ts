import { z } from 'zod';

import {
  academicProfileUpdateSchema,
  ACADEMIC_PROGRAMS,
  parseBatchLabel,
  type AcademicProfileView,
} from './academic.js';
import { paginationSchema } from './management.js';
import { normalizeVehicleNumber, type ParkingSessionView } from './operations.js';
import { VEHICLE_TYPES, type VehicleType } from './parking.js';
import {
  emailSchema,
  fullNameSchema,
  phoneSchema,
  VERIFICATION_STATUSES,
  type ParkingUserCategory,
  type RegisteredVehicle,
  type VerificationInfo,
  type VerificationStatus,
} from './portal.js';
import type { UserRole } from './roles.js';
import { VALIDATION_MESSAGES } from './validation.js';

/** Tabs of the Admin "Users" area. Visitors are listed from parking records, not accounts. */
export const USER_LIST_KINDS = ['ALL', 'STUDENT', 'STAFF'] as const;
export type UserListKind = (typeof USER_LIST_KINDS)[number];

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema.optional());

/** Whether a user's vehicle is parked right now. */
export const PARKING_STATUSES = ['PARKED', 'NOT_PARKED'] as const;
export type ParkingStatus = (typeof PARKING_STATUSES)[number];

export const userListQuerySchema = paginationSchema.extend({
  kind: optional(z.enum(USER_LIST_KINDS)).transform((value) => value ?? 'ALL'),
  /** Name, username, email or institutional ID (USN / staff ID), partial and case-insensitive. */
  q: optional(z.string().trim().max(64)),
  verification: optional(z.enum(VERIFICATION_STATUSES)),
  status: optional(z.enum(['ACTIVE', 'INACTIVE'])),
  /** Parked right now / not parked. */
  parking: optional(z.enum(PARKING_STATUSES)),
  // Student filters
  program: optional(z.enum(ACADEMIC_PROGRAMS)),
  department: optional(z.string().trim().max(80)),
  /** "2024–2027" (a hyphen works too): the admission year and program duration it implies. */
  batch: optional(
    z
      .string()
      .trim()
      .max(20)
      .refine((value) => parseBatchLabel(value) !== null, {
        error: VALIDATION_MESSAGES.invalidBatch,
      }),
  ),
  semester: optional(
    z.coerce
      .number({ error: VALIDATION_MESSAGES.semesterOutOfRange })
      .int({ error: VALIDATION_MESSAGES.semesterOutOfRange })
      .min(1, { error: VALIDATION_MESSAGES.semesterOutOfRange })
      .max(6, { error: VALIDATION_MESSAGES.semesterOutOfRange }),
  ),
});
export type UserListQuery = z.input<typeof userListQuerySchema>;

export interface ManagedParkingProfile {
  category: ParkingUserCategory;
  institutionalId: string;
  email: string;
  phone: string;
  verificationStatus: VerificationStatus;
  /** Students only; null for Campus Staff and for students registered before it was collected. */
  academic: AcademicProfileView | null;
}

export interface CurrentParking {
  sessionNumber: string;
  vehicleNumber: string;
  blockName: string;
  slotCode: string;
  entryAt: string;
}

export interface UserListItem {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  parkingUser: ManagedParkingProfile | null;
  vehicleCount: number;
  /** The user's vehicle parked right now, if any (parking users only). */
  currentParking: CurrentParking | null;
}

export interface UserCounts {
  /** Every account (parking users, security staff, administrators). */
  all: number;
  students: number;
  staff: number;
  pendingVerification: number;
  /** Distinct visitor vehicles with at least one parking session. */
  visitorVehicles: number;
  /** Student / Campus Staff members whose vehicle is parked right now. */
  activeParkingUsers: number;
  /** Visitor vehicles parked right now. */
  activeVisitors: number;
}

export interface IdentityDocumentInfo {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  institutionalId: string;
  uploadedAt: string;
}

export interface UserDetail extends UserListItem {
  verification: (VerificationInfo & { reviewedBy: string | null }) | null;
  documents: IdentityDocumentInfo[];
  vehicles: RegisteredVehicle[];
  /** Live sessions of the user's vehicles. History and receipts have their own pages. */
  activeSessions: ParkingSessionView[];
}

/**
 * Fields an administrator may correct. Role, category and credentials are not editable here.
 * `academic` is the legitimate-change path for a student's program, department, admission
 * year and semester (students cannot change them themselves); a student who has no academic
 * details yet needs all four.
 */
export const adminUserUpdateSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    academic: academicProfileUpdateSchema.optional(),
  })
  .strict();
export type AdminUserUpdate = z.input<typeof adminUserUpdateSchema>;

// ---------------------------------------------------------------------------
// Vehicle ownership lookup (Admin)
// ---------------------------------------------------------------------------

export const adminVehicleQuerySchema = paginationSchema.extend({
  /** Partial plate; spaces, dots and hyphens are ignored. */
  q: optional(z.string().trim().max(20).transform(normalizeVehicleNumber)),
  owned: optional(z.enum(['OWNED', 'UNOWNED'])),
  vehicleType: optional(z.enum(VEHICLE_TYPES)),
});
export type AdminVehicleQuery = z.input<typeof adminVehicleQuerySchema>;

export interface AdminVehicleItem {
  id: string;
  vehicleNumber: string;
  vehicleType: VehicleType;
  label: string | null;
  /** The one account that actively owns this plate; null for plates only the desk has seen. */
  owner: {
    userId: string;
    fullName: string;
    category: ParkingUserCategory;
    institutionalId: string;
    verificationStatus: VerificationStatus;
    isActive: boolean;
    since: string;
  } | null;
  sessionCount: number;
  activeSession: {
    sessionNumber: string;
    blockName: string;
    slotCode: string;
    entryAt: string;
  } | null;
  firstSeenAt: string;
}

export const userStatusRequestSchema = z.object({
  isActive: z.boolean({ error: VALIDATION_MESSAGES.selectOption }),
});

export const verificationDecisionSchema = z
  .object({
    decision: z.enum(['VERIFY', 'REJECT'], { error: VALIDATION_MESSAGES.selectOption }),
    note: z
      .string()
      .trim()
      .max(500, { error: VALIDATION_MESSAGES.tooLong })
      .optional()
      .transform((value) => (value ? value : undefined)),
  })
  .refine((value) => value.decision !== 'REJECT' || Boolean(value.note), {
    path: ['note'],
    error: VALIDATION_MESSAGES.rejectionNoteRequired,
  });
export type VerificationDecision = z.input<typeof verificationDecisionSchema>;

export const USER_AUDIENCES = ['ALL', 'STUDENTS', 'STAFF', 'USER'] as const;
export type UserAudience = (typeof USER_AUDIENCES)[number];

/** An important parking notice shown in the notification bell of the audience. */
export const sendNoticeRequestSchema = z
  .object({
    audience: z.enum(USER_AUDIENCES, { error: VALIDATION_MESSAGES.selectOption }),
    userId: z.uuid().optional(),
    title: z
      .string({ error: VALIDATION_MESSAGES.required })
      .trim()
      .min(1, { error: VALIDATION_MESSAGES.required })
      .max(80, { error: VALIDATION_MESSAGES.tooLong }),
    message: z
      .string({ error: VALIDATION_MESSAGES.required })
      .trim()
      .min(1, { error: VALIDATION_MESSAGES.required })
      .max(500, { error: VALIDATION_MESSAGES.tooLong }),
  })
  .refine((value) => value.audience !== 'USER' || Boolean(value.userId), {
    path: ['userId'],
    error: VALIDATION_MESSAGES.required,
  });
export type SendNoticeRequest = z.input<typeof sendNoticeRequestSchema>;

export interface SendNoticeResponse {
  delivered: number;
}
