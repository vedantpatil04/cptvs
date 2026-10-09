import type { RequestHandler } from 'express';

import { authService } from '../modules/auth/auth.service.js';

const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

/**
 * Requires a valid access token. The user is re-loaded from the database on
 * every request so that deactivation, role changes, logout and — for Student /
 * Campus Staff — the identity-verification decision take effect immediately; the
 * token alone is never trusted for authorisation.
 *
 * Everything behind this middleware is private and changes with the account, so
 * no browser, proxy or service worker may keep a copy: a cached `GET /auth/me`
 * is exactly how a screen would go on showing "not verified" after Admin approves.
 */
export const authenticate: RequestHandler = async (req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', Vary: 'Authorization' });
  const match = BEARER_PREFIX.exec(req.get('Authorization') ?? '');
  req.auth = await authService.authenticateToken(match?.[1]?.trim());
  next();
};
