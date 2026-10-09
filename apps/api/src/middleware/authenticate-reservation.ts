import type { RequestHandler } from 'express';

import { unauthenticated } from '../lib/errors.js';
import { tokenService } from '../modules/auth/token.service.js';

const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

/**
 * Requires a visitor reservation token. It identifies exactly one reservation and nothing
 * else; a visitor session token, an account token or a missing token is refused.
 */
export const authenticateReservation: RequestHandler = (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', Vary: 'Authorization' });
  const token = BEARER_PREFIX.exec(req.get('Authorization') ?? '')?.[1]?.trim();
  if (!token) {
    next(unauthenticated());
    return;
  }
  req.reservation = { reservationId: tokenService.verifyReservationToken(token) };
  next();
};
