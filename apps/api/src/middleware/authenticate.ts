import type { RequestHandler } from 'express';

import { authService } from '../modules/auth/auth.service.js';

const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

/**
 * Requires a valid access token. The user is re-loaded from the database on
 * every request so that deactivation, role changes and logout take effect
 * immediately — the token alone is never trusted for authorisation.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const match = BEARER_PREFIX.exec(req.get('Authorization') ?? '');
  req.auth = await authService.authenticateToken(match?.[1]?.trim());
  next();
};
