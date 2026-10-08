import { z } from 'zod';

import { PASSWORD_INPUT_MAX_LENGTH, passwordPolicySchema } from './auth.js';
import { campusDateSchema, paginationSchema, type HistoryItem } from './management.js';
import {
  MOCK_PAYMENT_OUTCOMES,
  PAYMENT_METHODS,
  normalizeVehicleNumber,
  sessionNumberSchema,
  slotCodeSchema,
  vehicleNumberSchema,
  type AllocationExplanation,
  type Coordinates,
  type ParkingMapResponse,
  type ParkingSessionView,
} from './operations.js';
import {
  VEHICLE_TYPES,
  type FeeRule,
  type OwnerCategory,
  type PublicAvailability,
  type VehicleType,
} from './parking.js';
import { SUPPORTED_LOCALES } from './locales.js';
import { VALIDATION_MESSAGES } from './validation.js';

// ---------------------------------------------------------------------------
// Parking-user categories and verification
// ---------------------------------------------------------------------------

/** Account categories. Visitors never get accounts. */
export const PARKING_USER_CATEGORIES = ['STUDENT', 'STAFF'] as const;
export type ParkingUserCategory = (typeof PARKING_USER_CATEGORIES)[number];

export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

export const fullNameSchema = z
  .string({ error: VALIDATION_MESSAGES.required })
  .trim()
  .min(2, { error: VALIDATION_MESSAGES.required })
  .max(120, { error: VALIDATION_MESSAGES.tooLong });

export const emailSchema = z
  .string({ error: VALIDATION_MESSAGES.required })
  .trim()
  .toLowerCase()
  .min(1, { error: VALIDATION_MESSAGES.required })
  .max(254, { error: VALIDATION_MESSAGES.tooLong })
  .pipe(z.email({ error: VALIDATION_MESSAGES.invalidEmail }));

/** Strips spaces, dashes and brackets; 10–15 digits with an optional leading +. */
export const normalizePhone = (value: string): string => value.replace(/[\s()-]/g, '');
export const phoneSchema = z
  .string({ error: VALIDATION_MESSAGES.required })
  .trim()
  .min(1, { error: VALIDATION_MESSAGES.required })
  .transform(normalizePhone)
  .pipe(z.string().regex(/^\+?\d{10,15}$/, { error: VALIDATION_MESSAGES.invalidPhone }));

/** Student USN or employee ID, e.g. 2BT22CS001 or EMP-1042. Upper-cased. */
export const INSTITUTIONAL_ID_PATTERN = /^[A-Z0-9][A-Z0-9/-]{2,31}$/;
export const institutionalIdSchema = z
  .string({ error: VALIDATION_MESSAGES.required })
  .trim()
  .toUpperCase()
  .min(1, { error: VALIDATION_MESSAGES.required })
  .pipe(
    z
      .string()
      .regex(INSTITUTIONAL_ID_PATTERN, { error: VALIDATION_MESSAGES.invalidInstitutionalId }),
  );

// ---------------------------------------------------------------------------
// Identity documents
// ---------------------------------------------------------------------------

export const IDENTITY_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type IdentityDocumentType = (typeof IDENTITY_DOCUMENT_TYPES)[number];
export const MAX_IDENTITY_DOCUMENT_BYTES = 2 * 1024 * 1024;
/** Base64 length of the largest accepted document (4 characters per 3 bytes). */
const MAX_DOCUMENT_BASE64_LENGTH = Math.ceil(MAX_IDENTITY_DOCUMENT_BYTES / 3) * 4;

/**
 * An uploaded document, base64-encoded. The server decodes it, checks the size
 * and recognises the real file type from its content (the declared type is
 * only a hint).
 */
export const identityDocumentUploadSchema = z.object(
  {
    fileName: z
      .string({ error: VALIDATION_MESSAGES.documentRequired })
      .trim()
      .min(1, { error: VALIDATION_MESSAGES.documentRequired })
      .max(255, { error: VALIDATION_MESSAGES.tooLong }),
    mimeType: z.enum(IDENTITY_DOCUMENT_TYPES, { error: VALIDATION_MESSAGES.documentType }),
    contentBase64: z
      .string({ error: VALIDATION_MESSAGES.documentRequired })
      .min(1, { error: VALIDATION_MESSAGES.documentRequired })
      .max(MAX_DOCUMENT_BASE64_LENGTH, { error: VALIDATION_MESSAGES.documentTooLarge })
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, { error: VALIDATION_MESSAGES.documentType }),
  },
  { error: VALIDATION_MESSAGES.documentRequired },
);
export type IdentityDocumentUpload = z.infer<typeof identityDocumentUploadSchema>;

// ---------------------------------------------------------------------------
// Registration and sign-in
// ---------------------------------------------------------------------------

/**
 * Student or Campus Staff registration. The category comes from the endpoint
 * (`/auth/register/student` or `/auth/register/staff`), never from the body.
 */
export const registrationRequestSchema = z
  .object({
    fullName: fullNameSchema,
    institutionalId: institutionalIdSchema,
    email: emailSchema,
    phone: phoneSchema,
    password: passwordPolicySchema,
    /** Step 2: the user confirms the ID printed on the document. */
    confirmInstitutionalId: institutionalIdSchema,
    document: identityDocumentUploadSchema,
  })
  .refine((value) => value.institutionalId === value.confirmInstitutionalId, {
    path: ['confirmInstitutionalId'],
    error: VALIDATION_MESSAGES.institutionalIdMismatch,
  });
export type RegistrationRequest = z.input<typeof registrationRequestSchema>;

export const userLoginRequestSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: VALIDATION_MESSAGES.required })
    .min(1, { error: VALIDATION_MESSAGES.required })
    .max(PASSWORD_INPUT_MAX_LENGTH, { error: VALIDATION_MESSAGES.tooLong }),
});
export type UserLoginRequest = z.input<typeof userLoginRequestSchema>;

/** Resubmission after a rejection: a new document, and the (possibly corrected) ID. */
export const verificationResubmissionSchema = z
  .object({
    institutionalId: institutionalIdSchema,
    confirmInstitutionalId: institutionalIdSchema,
    document: identityDocumentUploadSchema,
  })
  .refine((value) => value.institutionalId === value.confirmInstitutionalId, {
    path: ['confirmInstitutionalId'],
    error: VALIDATION_MESSAGES.institutionalIdMismatch,
  });
export type VerificationResubmission = z.input<typeof verificationResubmissionSchema>;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface VerificationInfo {
  status: VerificationStatus;
  /** Reviewer's note; always present for REJECTED. */
  note: string | null;
  submittedAt: string;
  reviewedAt: string | null;
}

export interface ParkingUserProfileView {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  category: ParkingUserCategory;
  institutionalId: string;
  verification: VerificationInfo;
  preferredLocale: string | null;
  vehicleCount: number;
  memberSince: string;
  /** The official fee rule for this account's category, per vehicle type (null if not configured). */
  pricing: Record<VehicleType, FeeRule> | null;
}

/** Safe self-service edits. Category, ID, email and verification are not editable. */
export const profileUpdateSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    phone: phoneSchema.optional(),
    preferredLocale: z.enum(SUPPORTED_LOCALES).nullable().optional(),
  })
  .strict();
export type ProfileUpdate = z.input<typeof profileUpdateSchema>;

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

const vehicleLabelSchema = z
  .string()
  .trim()
  .max(40, { error: VALIDATION_MESSAGES.tooLong })
  .transform((value) => (value === '' ? null : value))
  .nullable();

export const registerVehicleRequestSchema = z.object({
  vehicleNumber: vehicleNumberSchema,
  vehicleType: z.enum(VEHICLE_TYPES, { error: VALIDATION_MESSAGES.selectOption }),
  label: vehicleLabelSchema.optional(),
});
export type RegisterVehicleRequest = z.input<typeof registerVehicleRequestSchema>;

/** Number and type can change only while the vehicle has never been parked. */
export const updateVehicleRequestSchema = z
  .object({
    vehicleNumber: vehicleNumberSchema.optional(),
    vehicleType: z.enum(VEHICLE_TYPES, { error: VALIDATION_MESSAGES.selectOption }).optional(),
    label: vehicleLabelSchema.optional(),
  })
  .strict();
export type UpdateVehicleRequest = z.input<typeof updateVehicleRequestSchema>;

export interface VehicleParkingState {
  sessionNumber: string;
  blockName: string;
  slotCode: string;
  entryHour: number;
  entryAt: string;
}

export interface RegisteredVehicle {
  id: string;
  vehicleNumber: string;
  vehicleType: VehicleType;
  label: string | null;
  isPrimary: boolean;
  registeredAt: string;
  /** False once the vehicle has parking history: number and type are then fixed. */
  identityEditable: boolean;
  activeSession: VehicleParkingState | null;
}

// ---------------------------------------------------------------------------
// Portal views
// ---------------------------------------------------------------------------

/** A checkout whose payment was started but not completed. */
export interface PendingCheckout {
  sessionNumber: string;
  paymentId: string;
  amountPaise: number;
  exitHour: number;
}

export interface PortalOverview {
  generatedAt: string;
  availability: PublicAvailability[];
  /** The user's vehicles that are parked right now (usually one). */
  activeSessions: ParkingSessionView[];
  recentActivity: HistoryItem[];
  vehicleCount: number;
  /** All of the user's vehicles with their live parking state. */
  vehicles: RegisteredVehicle[];
  /** Active sessions with an unfinished payment. */
  pendingCheckouts: PendingCheckout[];
  /** The latest completed session, if it ended within the last 12 hours. */
  lastCompleted: HistoryItem | null;
}

/** Live layout without any other vehicle's details; `mySlots` marks the user's own. */
export interface PortalLayoutResponse extends ParkingMapResponse {
  mySlots: string[];
}

export const portalHistoryQuerySchema = paginationSchema.extend({
  vehicleNumber: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().max(20).transform(normalizeVehicleNumber).optional(),
  ),
  vehicleType: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(VEHICLE_TYPES).optional(),
  ),
  from: z.preprocess((value) => (value === '' ? undefined : value), campusDateSchema.optional()),
  to: z.preprocess((value) => (value === '' ? undefined : value), campusDateSchema.optional()),
});
export type PortalHistoryQuery = z.input<typeof portalHistoryQuerySchema>;

// ---------------------------------------------------------------------------
// Visitor access (no account)
// ---------------------------------------------------------------------------

/**
 * A visitor proves they hold the parking slip by giving both the vehicle
 * number and the session number printed on it.
 */
export const visitorAccessRequestSchema = z.object({
  vehicleNumber: vehicleNumberSchema,
  sessionNumber: sessionNumberSchema,
});
export type VisitorAccessRequest = z.input<typeof visitorAccessRequestSchema>;

export interface VisitorAccessResponse {
  accessToken: string;
  expiresAt: string;
  session: ParkingSessionView;
}

// ---------------------------------------------------------------------------
// "Park now": self-service parking through the same allocation engine
// ---------------------------------------------------------------------------

export const parkProposalRequestSchema = z.object({
  vehicleId: z.uuid({ error: VALIDATION_MESSAGES.required }),
});
export type ParkProposalRequest = z.input<typeof parkProposalRequestSchema>;

/**
 * The slot the allocation engine picked, held for the user for a short time so
 * they can confirm. The user never chooses a slot: this is the engine's choice.
 */
export interface ParkProposal {
  /** Secret that proves this user holds the slot; sent back to confirm or cancel. */
  proposalToken: string;
  expiresAt: string;
  vehicle: { id: string; vehicleNumber: string; vehicleType: VehicleType; label: string | null };
  slotCode: string;
  blockName: string;
  zoneName: string;
  coordinates: Coordinates | null;
  /** The account category that will be billed. */
  ownerCategory: OwnerCategory;
  /** Current campus hour: the entry hour of the session. */
  entryHour: number;
  allocation: AllocationExplanation;
  /** Free and total slots for the vehicle type when the proposal was made. */
  availability: { availableSlots: number; totalSlots: number };
}

export const parkConfirmRequestSchema = z.object({
  vehicleId: z.uuid({ error: VALIDATION_MESSAGES.required }),
  slotCode: slotCodeSchema,
  proposalToken: z
    .string({ error: VALIDATION_MESSAGES.required })
    .min(16, { error: VALIDATION_MESSAGES.required })
    .max(64, { error: VALIDATION_MESSAGES.tooLong }),
});
export type ParkConfirmRequest = z.input<typeof parkConfirmRequestSchema>;

export const parkCancelRequestSchema = parkConfirmRequestSchema.pick({
  slotCode: true,
  proposalToken: true,
});
export type ParkCancelRequest = z.input<typeof parkCancelRequestSchema>;

// ---------------------------------------------------------------------------
// Self-service checkout and (simulated) payment. The server picks the exit
// hour (the current campus hour); the fee comes from the fee engine.
// ---------------------------------------------------------------------------

export const selfPaymentRequestSchema = z.object({
  method: z.enum(PAYMENT_METHODS, { error: VALIDATION_MESSAGES.selectOption }),
});
export type SelfPaymentRequest = z.input<typeof selfPaymentRequestSchema>;

export const selfProcessPaymentSchema = z.object({
  outcome: z.enum(MOCK_PAYMENT_OUTCOMES).default('SUCCESS'),
});
export type SelfProcessPayment = z.input<typeof selfProcessPaymentSchema>;

// ---------------------------------------------------------------------------
// Notifications (lightweight, translated on the client by `type`)
// ---------------------------------------------------------------------------

export const NOTIFICATION_TYPES = [
  'VERIFICATION_APPROVED',
  'VERIFICATION_REJECTED',
  'RECEIPT_GENERATED',
  'VEHICLE_CHECKED_IN',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationData = Partial<{
  note: string;
  receiptNumber: string;
  amountPaise: number;
  vehicleNumber: string;
  sessionNumber: string;
  slotCode: string;
  blockName: string;
}>;

export interface NotificationView {
  id: string;
  type: NotificationType;
  createdAt: string;
  readAt: string | null;
  data: NotificationData;
}

export interface NotificationsResponse {
  items: NotificationView[];
  unreadCount: number;
}
