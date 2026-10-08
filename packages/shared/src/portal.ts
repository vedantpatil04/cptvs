import { z } from 'zod';

import { PASSWORD_INPUT_MAX_LENGTH, passwordPolicySchema } from './auth.js';
import { campusDateSchema, paginationSchema, type HistoryItem } from './management.js';
import {
  MOCK_PAYMENT_OUTCOMES,
  normalizeVehicleNumber,
  PAYMENT_METHODS,
  sessionNumberSchema,
  vehicleNumberSchema,
  type AllocationExplanation,
  type ParkingBlockSummary,
  type ParkingMapResponse,
  type ParkingSessionView,
} from './operations.js';
import { VEHICLE_TYPES, type PublicAvailability, type VehicleType } from './parking.js';
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
/** The validated, normalised registration (what the server works with). */
export type RegistrationInput = z.output<typeof registrationRequestSchema>;

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

/** A user can register at most this many vehicles (guards against squatting on plates). */
export const MAX_VEHICLES_PER_USER = 5;

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

export interface VehiclesResponse {
  vehicles: RegisteredVehicle[];
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

export interface PortalOverview {
  generatedAt: string;
  availability: PublicAvailability[];
  /** The user's vehicles that are parked right now (usually one). */
  activeSessions: ParkingSessionView[];
  recentActivity: HistoryItem[];
  vehicleCount: number;
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
// Park Now (Student / Campus Staff self-service)
// ---------------------------------------------------------------------------

/**
 * Step 1: the user picks one of their own vehicles. The server — never the
 * client — chooses the slot with the deterministic allocation engine and
 * holds it temporarily for the user.
 */
export const parkNowStartRequestSchema = z.object({
  vehicleId: z.uuid({ error: VALIDATION_MESSAGES.selectOption }),
});
export type ParkNowStartRequest = z.input<typeof parkNowStartRequestSchema>;

/** Step 2 (confirm) and the alternative (cancel) both refer to the offer. */
export const parkNowDecisionRequestSchema = z.object({
  offerId: z.uuid({ error: VALIDATION_MESSAGES.required }),
});
export type ParkNowDecisionRequest = z.input<typeof parkNowDecisionRequestSchema>;

export interface ParkNowOffer {
  offerId: string;
  /** The hold lapses at this time and the slot returns to the pool. */
  expiresAt: string;
  vehicle: { id: string; vehicleNumber: string; vehicleType: VehicleType; label: string | null };
  /** The category the session will be billed in: taken from the verified account. */
  ownerCategory: ParkingUserCategory;
  block: ParkingBlockSummary;
  allocation: AllocationExplanation;
}

/** The user's open offer, if any (lets the client resume after a reload). */
export interface CurrentParkNowOfferResponse {
  offer: ParkNowOffer | null;
}

export interface ParkNowConfirmation {
  session: ParkingSessionView;
  allocation: AllocationExplanation;
}

// ---------------------------------------------------------------------------
// Self-service checkout and payment (Student, Campus Staff)
// ---------------------------------------------------------------------------

/**
 * The exit time is the server's current campus hour: the user cannot choose
 * it. The fee always comes from the backend fee engine.
 */
export const selfCheckoutQuoteRequestSchema = z.object({ sessionNumber: sessionNumberSchema });
export type SelfCheckoutQuoteRequest = z.input<typeof selfCheckoutQuoteRequestSchema>;

export const selfPaymentRequestSchema = selfCheckoutQuoteRequestSchema.extend({
  method: z.enum(PAYMENT_METHODS, { error: VALIDATION_MESSAGES.selectOption }),
});
export type SelfPaymentRequest = z.input<typeof selfPaymentRequestSchema>;

// ---------------------------------------------------------------------------
// Visitor checkout (the access token already identifies the one session)
// ---------------------------------------------------------------------------

export const visitorPaymentRequestSchema = z.object({
  method: z.enum(PAYMENT_METHODS, { error: VALIDATION_MESSAGES.selectOption }),
});
export type VisitorPaymentRequest = z.input<typeof visitorPaymentRequestSchema>;

export const visitorProcessRequestSchema = z.object({
  outcome: z.enum(MOCK_PAYMENT_OUTCOMES).default('SUCCESS'),
});
export type VisitorProcessRequest = z.input<typeof visitorProcessRequestSchema>;

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_KINDS = [
  'VERIFICATION_APPROVED',
  'VERIFICATION_REJECTED',
  'PARKING_STARTED',
  'RECEIPT_GENERATED',
  'PARKING_NOTICE',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Values the client interpolates into the translated message for the `kind`. */
export type NotificationParams = Partial<{
  /** VERIFICATION_REJECTED: the reviewer's reason. */
  note: string;
  sessionNumber: string;
  slotCode: string;
  blockName: string;
  vehicleNumber: string;
  receiptNumber: string;
  amountPaise: number;
  /** PARKING_NOTICE: administrator-written text (shown as written). */
  title: string;
  message: string;
}>;

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  params: NotificationParams;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsResponse {
  items: NotificationView[];
  unreadCount: number;
}

export const notificationListQuerySchema = z.object({
  unreadOnly: z
    .preprocess((value) => value === true || value === 'true' || value === '1', z.boolean())
    .default(false),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type NotificationListQuery = z.input<typeof notificationListQuerySchema>;
