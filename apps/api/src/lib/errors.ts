import type { ApiErrorCode, ApiValidationIssue } from '@cpvts/shared';

/**
 * An expected, client-facing error. Anything else that reaches the error
 * handler is treated as an internal failure and never exposed to clients.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: ApiValidationIssue[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message = 'The request is invalid.') =>
  new AppError(400, 'BAD_REQUEST', message);

export const validationError = (details: ApiValidationIssue[]) =>
  new AppError(400, 'VALIDATION_ERROR', 'The request contains invalid data.', details);

export const unauthenticated = (message = 'Authentication is required.') =>
  new AppError(401, 'UNAUTHENTICATED', message);

export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'The requested resource was not found.') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message = 'The request conflicts with the current state.') =>
  new AppError(409, 'CONFLICT', message);
