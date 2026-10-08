import type { RequestHandler } from 'express';

import { forbidden, unauthenticated } from '../lib/errors.js';
import { accountErrors } from '../modules/accounts/accounts.errors.js';

/**
 * Allows only parking users whose identity verification has been approved.
 * The status is re-read from the database on every request (see `authenticate`),
 * so a decision or deactivation takes effect immediately.
 */
export const requireVerified: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    next(unauthenticated());
    return;
  }
  const { parkingUser } = req.auth.user;
  if (!parkingUser) {
    next(forbidden());
    return;
  }
  if (parkingUser.verificationStatus !== 'VERIFIED') {
    next(accountErrors.verificationRequired());
    return;
  }
  next();
};
