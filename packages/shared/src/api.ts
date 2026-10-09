/** Machine-readable error codes returned by the CPVTS API. */
export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_DISABLED',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  // Parking operations (Phase 2)
  'DUPLICATE_ACTIVE_VEHICLE',
  'VEHICLE_TYPE_MISMATCH',
  'ZONE_NOT_CONFIGURED',
  'ZONE_FULL',
  'ALLOCATION_FAILED',
  'SESSION_NOT_FOUND',
  'SESSION_NOT_ACTIVE',
  'EXIT_BEFORE_ENTRY',
  'VEHICLE_SESSION_MISMATCH',
  'SESSION_SLOT_MISMATCH',
  'INVALID_QR_REFERENCE',
  'FEE_SCHEDULE_NOT_CONFIGURED',
  'INVALID_PAYMENT_METHOD',
  'PAYMENT_NOT_FOUND',
  'PAYMENT_SESSION_MISMATCH',
  'PAYMENT_NOT_PENDING',
  'PAYMENT_IN_PROGRESS',
  'PAYMENT_AMOUNT_MISMATCH',
  'RECEIPT_NOT_FOUND',
  // Management (Phase 3)
  'SLOT_NOT_FOUND',
  'SLOT_NOT_AVAILABLE',
  'SLOT_NOT_BLOCKED',
  'BLOCK_NOT_FOUND',
  'DATE_RANGE_TOO_LARGE',
  // Parking users
  'EMAIL_TAKEN',
  'INSTITUTIONAL_ID_TAKEN',
  'EMAIL_DOMAIN_NOT_ALLOWED',
  'INVALID_DOCUMENT',
  'VERIFICATION_REQUIRED',
  'VERIFICATION_NOT_REJECTED',
  'VERIFICATION_NOT_PENDING',
  'VEHICLE_ALREADY_REGISTERED',
  'VEHICLE_NOT_FOUND',
  'VEHICLE_IDENTITY_LOCKED',
  'USER_NOT_FOUND',
  'DOCUMENT_NOT_FOUND',
  'CANNOT_CHANGE_OWN_STATUS',
  'VISITOR_ACCESS_DENIED',
  // Self-service parking and notifications
  'VEHICLE_LIMIT_REACHED',
  'OFFER_NOT_FOUND',
  'OFFER_EXPIRED',
  'NOTIFICATION_NOT_FOUND',
  // Inventory management (slots, zones, blocks)
  'SLOT_CODE_TAKEN',
  'SLOT_CODE_MISMATCH',
  'SLOT_IN_USE',
  'SLOT_HAS_HISTORY',
  'SLOT_ARCHIVED',
  'SLOT_NOT_ARCHIVED',
  'ZONE_NOT_FOUND',
  'ZONE_INACTIVE',
  'ZONE_TYPE_MISMATCH',
  'ZONE_CODE_TAKEN',
  'ZONE_IN_USE',
  'BLOCK_CODE_TAKEN',
  'BLOCK_IN_USE',
  // Gate-controlled checkout and QR
  'GATE_CHECKOUT_REQUIRED',
  'QR_SESSION_MISMATCH',
  'SESSION_INCONSISTENT',
  // Security Staff shifts and cash
  'SHIFT_REQUIRED',
  'SHIFT_NOT_FOUND',
  'SHIFT_CONFLICT',
  'SHIFT_INVALID_STATE',
  'SHIFT_TOO_EARLY',
  'SHIFT_ENDED',
  'SHIFT_HAS_OPEN_PAYMENTS',
  'SHIFT_TEMPLATE_NOT_FOUND',
  'SHIFT_TEMPLATE_NAME_TAKEN',
  'SECURITY_STAFF_NOT_FOUND',
  'HANDOVER_ALREADY_RECORDED',
  'HANDOVER_NOT_FOUND',
  'DISCREPANCY_NOT_OPEN',
  'CASH_NOTE_REQUIRED',
  // Vehicle ownership
  'VEHICLE_PARKED',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiValidationIssue {
  /** Dot-separated path of the invalid field, e.g. `body.username`. */
  path: string;
  /** Translation key describing the problem (see `VALIDATION_MESSAGES`). */
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** English fallback text. Clients should translate using `code`. */
    message: string;
    requestId?: string;
    details?: ApiValidationIssue[];
  };
}

export type DependencyStatus = 'up' | 'down';

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

export interface ReadinessResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  checks: {
    database: DependencyStatus;
  };
}

export interface SystemStatusResponse {
  environment: string;
  version: string;
  serverTime: string;
  uptimeSeconds: number;
  database: {
    status: DependencyStatus;
    latencyMs: number | null;
  };
}
