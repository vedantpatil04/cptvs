import type { RequestHandler } from 'express';

import { unauthenticated } from '../lib/errors.js';
import { tokenService } from '../modules/auth/token.service.js';

const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

/**
 * Requires a visitor access token. It identifies exactly one parking session
 * and nothing else: the token has its own audience, so it is rejected by
 * `authenticate` (and account tokens are rejected here). It never carries a
 * user, role or any account permission.
 */
export const authenticateVisitor: RequestHandler = (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', Vary: 'Authorization' });
  const token = BEARER_PREFIX.exec(req.get('Authorization') ?? '')?.[1]?.trim();
  if (!token) {
    next(unauthenticated());
    return;
  }
  req.visitor = { sessionId: tokenService.verifyVisitorToken(token) };
  next();
};
