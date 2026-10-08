import type { UserRole } from '@cpvts/shared';
import type { RequestHandler } from 'express';

import { forbidden, unauthenticated } from '../lib/errors.js';

/** Allows the request only if the authenticated user has one of `roles`. Use after `authenticate`. */
export const authorize =
  (...roles: [UserRole, ...UserRole[]]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) {
      next(unauthenticated());
      return;
    }
    if (!roles.includes(req.auth.user.role)) {
      next(forbidden());
      return;
    }
    next();
  };
