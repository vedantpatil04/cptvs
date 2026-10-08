import type { ApiErrorBody } from '@cpvts/shared';
import { rateLimit } from 'express-rate-limit';

import { config } from '../config/index.js';

/** Throttles credential guessing on the login endpoint (per client IP). */
export const loginRateLimiter = rateLimit({
  windowMs: config.rateLimit.login.windowMs,
  limit: config.rateLimit.login.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Only failed attempts count, so staff who sign in correctly are never locked out.
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    const body: ApiErrorBody = {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many sign-in attempts. Please wait and try again.',
        requestId: req.id,
      },
    };
    res.status(429).json(body);
  },
});
