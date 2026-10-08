import { z } from 'zod';

import { paginationSchema } from './management.js';
import type { ParkingSessionView } from './operations.js';
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

export const userListQuerySchema = paginationSchema.extend({
  kind: optional(z.enum(USER_LIST_KINDS)).transform((value) => value ?? 'ALL'),
  /** Name, username, email or institutional ID (partial, case-insensitive). */
  q: optional(z.string().trim().max(64)),
  verification: optional(z.enum(VERIFICATION_STATUSES)),
  status: optional(z.enum(['ACTIVE', 'INACTIVE'])),
});
export type UserListQuery = z.input<typeof userListQuerySchema>;

export interface ManagedParkingProfile {
  category: ParkingUserCategory;
  institutionalId: string;
  email: string;
  phone: string;
  verificationStatus: VerificationStatus;
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

/** Fields an administrator may correct. Role, category and credentials are not editable here. */
export const adminUserUpdateSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .strict();
export type AdminUserUpdate = z.input<typeof adminUserUpdateSchema>;

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
