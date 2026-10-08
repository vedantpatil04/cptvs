import type { Request } from 'express';

import type { AuthContext, RequestMeta } from '../modules/auth/auth.types.js';
import { unauthenticated } from './errors.js';

/** Client details recorded in the audit log. */
export const requestMeta = (req: Request): RequestMeta => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get('User-Agent') ?? null,
});

/** The authenticated principal. Use only behind the `authenticate` middleware. */
export const requireAuth = (req: Request): AuthContext => {
  if (!req.auth) throw unauthenticated();
  return req.auth;
};
