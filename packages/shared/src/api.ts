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
