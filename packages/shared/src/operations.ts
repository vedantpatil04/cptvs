import { z } from 'zod';

import {
  OWNER_CATEGORIES,
  VEHICLE_TYPES,
  type FeeRule,
  type OwnerCategory,
  type VehicleType,
} from './parking.js';
import type { HistoryItem } from './management.js';
import type { UserCounts } from './users.js';
import { VALIDATION_MESSAGES } from './validation.js';

// ---------------------------------------------------------------------------
// Identifiers and input formats
// ---------------------------------------------------------------------------

/** Removes spaces, dots and hyphens and upper-cases: "ka-22 ab 1234" → "KA22AB1234". */
export const normalizeVehicleNumber = (value: string): string =>
  value.toUpperCase().replace(/[\s.\-_/]/g, '');

/**
 * Supported registration formats (after normalisation):
 *  - standard: state code, RTO number, optional series, number — KA22AB1234, KA01A123
 *  - Bharat series: YY BH NNNN XX — 22BH1234AB
 */
const STANDARD_REGISTRATION = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/;
const BHARAT_REGISTRATION = /^\d{2}BH\d{4}[A-Z]{1,2}$/;

export const isValidVehicleNumber = (normalized: string): boolean =>
  STANDARD_REGISTRATION.test(normalized) || BHARAT_REGISTRATION.test(normalized);

/**
 * Hides the middle of a plate for places anyone holding a link can see (the public receipt
 * check): "KA22AB1234" → "KA****1234". The holder of the receipt can still recognise their own.
 */
export const maskVehicleNumber = (vehicleNumber: string): string => {
  const keepEnd = vehicleNumber.length >= 8 ? 4 : 2;
  const hidden = Math.max(0, vehicleNumber.length - 2 - keepEnd);
  return `${vehicleNumber.slice(0, 2)}${'*'.repeat(hidden)}${vehicleNumber.slice(vehicleNumber.length - keepEnd)}`;
};

/** Unambiguous upper-case alphabet (Crockford base32: no I, L, O, U). */
export const IDENTIFIER_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const SESSION_NUMBER_PATTERN = /^CPVTS-P-[0-9A-HJKMNP-TV-Z]{8}$/;
export const RECEIPT_NUMBER_PATTERN = /^CPVTS-R-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/;
export const TRANSACTION_ID_PATTERN = /^TXN-[0-9A-HJKMNP-TV-Z]{10}$/;
/** Slot IDs as configured in the layout, e.g. T-01, F-05. */
export const SLOT_CODE_PATTERN = /^[A-Z0-9]{1,8}-[A-Z0-9]{1,8}$/;

/** Prefix of the text encoded in an entry/session QR code. */
export const ENTRY_QR_PREFIX = 'cpvts:session:';
/** Opaque references are 32 random bytes encoded as base64url (43 characters). */
export const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Text to encode in the entry QR for a session. Contains only the opaque reference. */
export const entryQrPayload = (entryReference: string): string =>
  `${ENTRY_QR_PREFIX}${entryReference}`;

/** Extracts the opaque reference from scanned QR text, or null if it is not a CPVTS entry QR. */
export const parseEntryQrPayload = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith(ENTRY_QR_PREFIX)) return null;
  const reference = trimmed.slice(ENTRY_QR_PREFIX.length);
  return OPAQUE_REFERENCE_PATTERN.test(reference) ? reference : null;
};

/** Web path of the public receipt verification page; the QR encodes `<origin>/verify/<reference>`. */
export const RECEIPT_VERIFICATION_PATH = '/verify';

// ---------------------------------------------------------------------------
// Request schemas (shared by API validation and web forms)
// ---------------------------------------------------------------------------

export const vehicleNumberSchema = z
  .string({ error: VALIDATION_MESSAGES.required })
  .trim()
  .min(1, { error: VALIDATION_MESSAGES.required })
  .max(20, { error: VALIDATION_MESSAGES.tooLong })
  .transform(normalizeVehicleNumber)
  .refine(isValidVehicleNumber, { error: VALIDATION_MESSAGES.invalidVehicleNumber });

export const hourSchema = z
  .number({ error: VALIDATION_MESSAGES.invalidHour })
  .int({ error: VALIDATION_MESSAGES.invalidHour })
  .min(0, { error: VALIDATION_MESSAGES.invalidHour })
  .max(23, { error: VALIDATION_MESSAGES.invalidHour });

export const sessionNumberSchema = z
  .string({ error: VALIDATION_MESSAGES.required })
  .trim()
  .toUpperCase()
  .regex(SESSION_NUMBER_PATTERN, { error: VALIDATION_MESSAGES.invalidSessionNumber });

export const slotCodeSchema = z
  .string({ error: VALIDATION_MESSAGES.required })
  .trim()
  .toUpperCase()
  .regex(SLOT_CODE_PATTERN, { error: VALIDATION_MESSAGES.invalidSlotCode });

const vehicleTypeSchema = z.enum(VEHICLE_TYPES, { error: VALIDATION_MESSAGES.selectOption });
const ownerCategorySchema = z.enum(OWNER_CATEGORIES, { error: VALIDATION_MESSAGES.selectOption });

export const checkInRequestSchema = z.object({
  vehicleNumber: vehicleNumberSchema,
  vehicleType: vehicleTypeSchema,
  ownerCategory: ownerCategorySchema,
  entryHour: hourSchema,
});
export type CheckInRequest = z.input<typeof checkInRequestSchema>;

/** Entry desk: what is known about a plate before the owner category is chosen. */
export const vehicleLookupQuerySchema = z.object({ vehicleNumber: vehicleNumberSchema });
export type VehicleLookupQuery = z.input<typeof vehicleLookupQuerySchema>;

export const trackingQuerySchema = z.object({
  q: z
    .string({ error: VALIDATION_MESSAGES.required })
    .trim()
    .min(1, { error: VALIDATION_MESSAGES.required })
    .max(200, { error: VALIDATION_MESSAGES.tooLong }),
});

/**
 * Checkout identifies the session by its number. Any other identifier the
 * operator used (vehicle number, slot) is sent too and must refer to the same
 * active session, otherwise the request is rejected as a mismatch.
 */
export const checkoutQuoteRequestSchema = z.object({
  sessionNumber: sessionNumberSchema,
  /**
   * Optional manual override of the billable exit hour. The app leaves it out: the server uses the
   * exit time it captured when the session was scanned at the exit gate (or that Security
   * corrected), so the client never decides the exit time or the fee.
   */
  exitHour: hourSchema.optional(),
  vehicleNumber: vehicleNumberSchema.optional(),
  slotCode: slotCodeSchema.optional(),
  /**
   * The scanned session QR (`cpvts:session:<ref>`) or its bare reference, when the
   * checkout started from a scan. It must belong to this session, so a QR cannot be
   * attached to a different session's checkout.
   */
  entryReference: z.string().trim().max(300, { error: VALIDATION_MESSAGES.tooLong }).optional(),
});
export type CheckoutQuoteRequest = z.input<typeof checkoutQuoteRequestSchema>;

/**
 * Gate checkout by camera: the scanned text of the session QR. The server extracts the
 * opaque reference, looks it up and verifies the session before anything else happens —
 * the QR alone never completes a checkout (an authorized operator still pays and finalizes).
 */
export const scanCheckoutRequestSchema = z.object({
  qr: z
    .string({ error: VALIDATION_MESSAGES.required })
    .trim()
    .min(1, { error: VALIDATION_MESSAGES.required })
    .max(300, { error: VALIDATION_MESSAGES.tooLong }),
});
export type ScanCheckoutRequest = z.input<typeof scanCheckoutRequestSchema>;

/**
 * Security's audited correction of a session's recorded times before the final checkout. Times
 * are instants (ISO 8601 with offset); the app shows and edits them on the campus clock. The
 * fee is never sent: the server recalculates it from the corrected times.
 */
export const adjustSessionTimeRequestSchema = z.object({
  entryAt: z.iso.datetime({ offset: true, error: VALIDATION_MESSAGES.invalidDate }),
  exitAt: z.iso.datetime({ offset: true, error: VALIDATION_MESSAGES.invalidDate }),
  reason: z
    .string({ error: VALIDATION_MESSAGES.required })
    .trim()
    .min(3, { error: VALIDATION_MESSAGES.required })
    .max(200, { error: VALIDATION_MESSAGES.tooLong }),
  /** The guard confirmed the correction. */
  confirm: z.literal(true, { error: VALIDATION_MESSAGES.required }),
});
export type AdjustSessionTimeRequest = z.input<typeof adjustSessionTimeRequestSchema>;

/** Digits in the short exit code an owner can read out when the session QR cannot be scanned. */
export const EXIT_CODE_LENGTH = 6;

/**
 * Gate checkout by exit code: the 6 digits shown in the owner's or visitor's app. Like the QR
 * it only finds and verifies the ACTIVE session; payment and finalization stay separate steps.
 */
export const codeCheckoutRequestSchema = z.object({
  code: z
    .string({ error: VALIDATION_MESSAGES.invalidExitCode })
    .trim()
    .regex(/^[0-9]{6}$/, { error: VALIDATION_MESSAGES.invalidExitCode }),
});
export type CodeCheckoutRequest = z.input<typeof codeCheckoutRequestSchema>;

/** A freshly issued exit code. It is shown once; the server keeps only a keyed hash of it. */
export interface ExitCodeResponse {
  sessionNumber: string;
  code: string;
  /** ISO instant after which the code no longer works. */
  expiresAt: string;
  ttlSeconds: number;
}

export const PAYMENT_METHODS = ['UPI', 'CARD', 'CASH', 'NO_CHARGE'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Methods offered when an amount is due. `NO_CHARGE` is used only for ₹0 checkouts. */
export const CHARGEABLE_PAYMENT_METHODS = ['UPI', 'CARD', 'CASH'] as const;

export const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const createPaymentRequestSchema = checkoutQuoteRequestSchema.extend({
  method: z.enum(PAYMENT_METHODS, { error: VALIDATION_MESSAGES.selectOption }),
});
export type CreatePaymentRequest = z.input<typeof createPaymentRequestSchema>;

/** Simulated outcome for the test/demo payment provider. */
export const MOCK_PAYMENT_OUTCOMES = ['SUCCESS', 'FAILURE'] as const;

export const processPaymentRequestSchema = z.object({
  sessionNumber: sessionNumberSchema,
  outcome: z.enum(MOCK_PAYMENT_OUTCOMES).default('SUCCESS'),
});
export type ProcessPaymentRequest = z.input<typeof processPaymentRequestSchema>;

export const cancelPaymentRequestSchema = z.object({ sessionNumber: sessionNumberSchema });

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type SlotStatus = 'AVAILABLE' | 'HELD' | 'OCCUPIED' | 'BLOCKED' | 'RESERVED';
export type ParkingSessionStatus = 'ACTIVE' | 'COMPLETED';

/**
 * ACTIVE → (optional) EXIT_REQUESTED → COMPLETED. EXIT_REQUESTED means the owner or
 * visitor said "ready to leave"; the vehicle is still parked, the slot is still occupied
 * and only the gate checkout (payment, receipt) completes the session.
 */
export type SessionLifecycle = 'ACTIVE' | 'EXIT_REQUESTED' | 'COMPLETED';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface ParkingBlockSummary {
  code: string;
  name: string;
  coordinates: Coordinates | null;
}

/** One line of a fee breakdown. Produced only by the backend fee engine. */
export type FeeLine =
  | { kind: 'FREE'; hours: number }
  | { kind: 'CHARGED'; hours: number; ratePaise: number; amountPaise: number };

export interface FeeBreakdown {
  ownerCategory: OwnerCategory;
  vehicleType: VehicleType;
  durationHours: number;
  rule: FeeRule;
  lines: FeeLine[];
  totalPaise: number;
}

export interface ParkingSessionView {
  sessionNumber: string;
  status: ParkingSessionStatus;
  /** ACTIVE, EXIT_REQUESTED (ready to leave, still parked) or COMPLETED. */
  lifecycle: SessionLifecycle;
  /** When the owner or visitor marked the session "ready to leave"; null if they have not. */
  exitRequestedAt: string | null;
  vehicleNumber: string;
  vehicleType: VehicleType;
  ownerCategory: OwnerCategory;
  block: ParkingBlockSummary;
  zone: { code: string; name: string };
  slotCode: string;
  entryHour: number;
  entryAt: string;
  /** Opaque reference for the entry QR. Present only while the session is ACTIVE. */
  entryReference: string | null;
  /** Live values for ACTIVE sessions, based on the current campus hour. */
  currentHour: number | null;
  currentDurationHours: number | null;
  /** Fee if the vehicle left at the current hour (authoritative fee engine); null if unavailable. */
  estimatedFee: FeeBreakdown | null;
  /**
   * The exit instant the server captured at the exit gate. While set on an ACTIVE session the
   * timer is stopped and the live values above are those of this instant. Null otherwise.
   */
  exitCapturedAt: string | null;
  /** True when Security corrected the entry and/or exit time (see the audit history). */
  timeAdjusted: boolean;
  /** Final values from the finalized transaction (COMPLETED sessions only). */
  exitHour: number | null;
  exitAt: string | null;
  durationHours: number | null;
  fee: FeeBreakdown | null;
  receiptNumber: string | null;
}

export type AllocationCheck =
  'CORRECT_ZONE' | 'AVAILABLE' | 'NOT_BLOCKED' | 'BEST_SCORE' | 'FINAL_AVAILABILITY_VERIFIED';

export interface AllocationExplanation {
  slotCode: string;
  zoneName: string;
  blockName: string;
  score: number;
  /** Inputs to the score, shown for transparency. */
  factors: { priority: number; usesToday: number; layoutPosition: number };
  candidatesConsidered: number;
  /** Candidates skipped because another terminal claimed them first. */
  fallbacks: number;
  checks: AllocationCheck[];
}

export interface CheckInResponse {
  session: ParkingSessionView;
  allocation: AllocationExplanation;
  /**
   * `ACCOUNT` when the vehicle belongs to a verified Student / Campus Staff
   * account: the owner category then comes from that account, not the operator.
   */
  categorySource: 'ACCOUNT' | 'OPERATOR';
}

/**
 * Aggregate facts only: no names, IDs or contact details of the owner. When
 * `accountCategory` is set the vehicle belongs to a verified, active Student /
 * Campus Staff account and check-in will bill in that category regardless of
 * what the operator selects.
 */
export interface VehicleLookupResponse {
  vehicleNumber: string;
  known: boolean;
  vehicleType: VehicleType | null;
  accountCategory: OwnerCategory | null;
  hasActiveSession: boolean;
}

export interface ActiveSessionsResponse {
  currentHour: number;
  sessions: ParkingSessionView[];
}

export type TrackingMatch = 'VEHICLE_NUMBER' | 'SLOT' | 'SESSION_NUMBER' | 'ENTRY_QR';

export interface TrackingResponse {
  matchedBy: TrackingMatch;
  session: ParkingSessionView;
}

/**
 * What the server verified before returning a scanned session: the reference is a real
 * session reference, the session is ACTIVE, and the vehicle, session and slot records agree.
 */
export interface ScanChecks {
  reference: true;
  sessionActive: true;
  vehicleMatchesSession: true;
  slotMatchesSession: true;
}

/** Result of scanning a session QR at the exit gate. The next step is the checkout quote. */
export interface ScanCheckoutResponse {
  matchedBy: 'ENTRY_QR' | 'EXIT_CODE';
  session: ParkingSessionView;
  /** The owner or visitor already marked the session "ready to leave". */
  exitRequested: boolean;
  /** The exit instant captured by the server on the first exit scan; repeated scans return it unchanged. */
  exitAt: string;
  checks: ScanChecks;
}

/** Query of the active-sessions board. */
export const activeSessionsQuerySchema = z.object({
  /** Only sessions whose owner or visitor marked them "ready to leave". */
  exitRequested: z
    .preprocess((value) => value === true || value === 'true' || value === '1', z.boolean())
    .default(false),
});
export type ActiveSessionsQuery = z.input<typeof activeSessionsQuerySchema>;

export interface ParkingMapOccupant {
  sessionNumber: string;
  vehicleNumber: string;
  vehicleType: VehicleType;
  ownerCategory: OwnerCategory;
  entryHour: number;
  currentDurationHours: number;
}

export interface ParkingMapSlot {
  code: string;
  /** HELD is reported as-is; clients may present it as "being assigned". */
  status: SlotStatus;
  blockedReason: string | null;
  occupant: ParkingMapOccupant | null;
}

export interface SlotCounts {
  total: number;
  available: number;
  occupied: number;
  blocked: number;
  /** Briefly reserved during allocation. */
  held: number;
  /** Kept by Security for a VIP / emergency vehicle: never allocated, not counted as free. */
  reserved?: number;
}

export interface ParkingMapZone {
  code: string;
  name: string;
  vehicleType: VehicleType;
  /**
   * False when the zone (or its block) is disabled: nothing new is allocated there. Such a zone
   * only appears while vehicles are still parked in it, and then lists just those vehicles.
   */
  isActive: boolean;
  counts: SlotCounts;
  slots: ParkingMapSlot[];
}

export interface ParkingMapBlock {
  code: string;
  name: string;
  description: string | null;
  coordinates: Coordinates | null;
  /** False for a disabled block that still has vehicles parked in it. */
  isActive: boolean;
  zones: ParkingMapZone[];
}

export interface ParkingMapResponse {
  generatedAt: string;
  currentHour: number;
  blocks: ParkingMapBlock[];
}

export interface AdjustSessionTimeResponse {
  /** Fresh server-side pricing of the corrected times. */
  quote: CheckoutQuote;
}

export interface CheckoutQuote {
  session: ParkingSessionView;
  /** The exit instant this quote is priced for (captured at the gate, or corrected). */
  exitAt: string;
  /** True when Security corrected the entry and/or exit time. */
  timeAdjusted: boolean;
  exitHour: number;
  durationHours: number;
  fee: FeeBreakdown;
}

export interface PaymentView {
  id: string;
  transactionId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountPaise: number;
  exitHour: number;
  /** Always true: CPVTS uses a simulated payment provider. No real money moves. */
  isSimulated: boolean;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface CreatePaymentResponse {
  payment: PaymentView;
  quote: CheckoutQuote;
}

export interface ReceiptView {
  receiptNumber: string;
  verificationReference: string;
  issuedAt: string;
  sessionNumber: string;
  vehicleNumber: string;
  vehicleType: VehicleType;
  ownerCategory: OwnerCategory;
  block: ParkingBlockSummary;
  slotCode: string;
  entryHour: number;
  exitHour: number;
  durationHours: number;
  fee: FeeBreakdown;
  totalPaise: number;
  payment: {
    status: PaymentStatus;
    method: PaymentMethod;
    transactionId: string;
    isSimulated: boolean;
    paidAt: string | null;
  };
}

export interface ProcessPaymentResponse {
  payment: PaymentView;
  /** Present when the payment succeeded and the transaction was finalized. */
  receipt: ReceiptView | null;
}

export type ReceiptVerificationStatus = 'VALID' | 'INVALID';

/** Safe subset shown on the public verification page. */
export interface ReceiptVerificationResponse {
  status: ReceiptVerificationStatus;
  receipt: {
    receiptNumber: string;
    issuedAt: string;
    /** Masked (e.g. KA****1234): the public check never reveals a full plate. */
    vehicleNumber: string;
    blockName: string;
    slotCode: string;
    durationHours: number;
    amountPaise: number;
    paymentStatus: PaymentStatus;
    isSimulated: boolean;
  };
}

export interface OccupancySummary extends SlotCounts {
  /** Occupied (including briefly held) slots as a percentage of usable (non-blocked) slots. */
  occupancyPercent: number;
}

export interface DashboardSummary {
  generatedAt: string;
  overall: OccupancySummary;
  byVehicleType: (OccupancySummary & { vehicleType: VehicleType })[];
  currentlyParked: number;
  todayVehicleCount: number;
  /** Sum of today's finalized receipts. Null for roles that may not see revenue. */
  todayFeesCollectedPaise: number | null;
  /** Account and verification figures. Administrators only (null otherwise). */
  users: UserCounts | null;
  /** The latest parking sessions. Administrators only (null otherwise). */
  recentActivity: HistoryItem[] | null;
}
