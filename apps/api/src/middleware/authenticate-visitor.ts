import type { RequestHandler } from 'express';

import { tokenService } from '../modules/auth/token.service.js';
import { unauthenticated } from '../lib/errors.js';

const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

/**
 * Requires a visitor access token and exposes the one parking session it
 * grants as `req.visitor`. It never sets `req.auth`: a visitor can reach only
 * the visitor routes, and account tokens are not accepted here (different
 * audience on both sides).
 */
export const authenticateVisitor: RequestHandler = (req, _res, next) => {
  const token = BEARER_PREFIX.exec(req.get('Authorization') ?? '')?.[1]?.trim();
  if (!token) {
    next(unauthenticated());
    return;
  }
  req.visitor = { sessionId: tokenService.verifyVisitorToken(token) };
  next();
};
