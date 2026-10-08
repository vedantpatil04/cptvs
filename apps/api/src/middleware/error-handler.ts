import type { ApiErrorBody, ApiErrorCode } from '@cpvts/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';

import { AppError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** Errors raised by Express' body parser carry an HTTP status and a `type`. */
interface HttpParserError {
  status: number;
  type: string;
}

const isParserError = (error: unknown): error is HttpParserError =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as HttpParserError).status === 'number' &&
  typeof (error as HttpParserError).type === 'string';

const toAppError = (error: unknown): AppError | null => {
  if (error instanceof AppError) return error;
  if (isParserError(error)) {
    if (error.type === 'entity.too.large') {
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
    }
    if (error.status >= 400 && error.status < 500) {
      return new AppError(400, 'BAD_REQUEST', 'The request body could not be parsed.');
    }
  }
  return null;
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound('The requested endpoint does not exist.'));
};

/**
 * Centralised error handler. Known errors become a stable JSON envelope;
 * unknown errors are logged with their stack and returned as a generic 500
 * so internal details never leak to clients.
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError = toAppError(error);
  const status = appError?.status ?? 500;
  const code: ApiErrorCode = appError?.code ?? 'INTERNAL_ERROR';

  if (!appError) {
    logger.error('unhandled error', { requestId: req.id, err: error });
  }

  const body: ApiErrorBody = {
    error: {
      code,
      message: appError?.message ?? 'An unexpected error occurred.',
      requestId: req.id,
      ...(appError?.details ? { details: appError.details } : {}),
    },
  };
  res.status(status).json(body);
};
