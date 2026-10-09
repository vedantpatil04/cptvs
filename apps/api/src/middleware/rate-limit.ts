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

/**
 * Throttles guessing of vehicle number + session number pairs on visitor access
 * (per client IP). Only failed attempts count, like the sign-in limiter.
 */
export const visitorAccessRateLimiter = rateLimit({
  windowMs: config.rateLimit.login.windowMs,
  limit: config.rateLimit.login.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    const body: ApiErrorBody = {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Please wait and try again.',
        requestId: req.id,
      },
    };
    res.status(429).json(body);
  },
});

/**
 * Throttles guessing of 6-digit exit codes at the gate, per signed-in operator. Only failed
 * attempts count, so an operator who types the right code is never locked out.
 */
export const createExitCodeRateLimiter = (options: { windowMs: number; limit: number }) =>
  rateLimit({
    ...options,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => req.auth?.user.id ?? 'anonymous',
    handler: (req, res) => {
      const body: ApiErrorBody = {
        error: {
          code: 'RATE_LIMITED',
          message:
            'Too many incorrect codes. Please wait and try again, or look the vehicle up manually.',
          requestId: req.id,
        },
      };
      res.status(429).json(body);
    },
  });

export const exitCodeRateLimiter = createExitCodeRateLimiter({
  windowMs: config.rateLimit.login.windowMs,
  limit: config.rateLimit.login.max,
});

/**
 * Limits visitor reservations per client IP (the same hourly budget as registrations): the
 * public form must not be a way to hoard slots.
 */
export const visitorReservationRateLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: config.rateLimit.registrationPerHour,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    const body: ApiErrorBody = {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many parking requests from this network. Please try again later.',
        requestId: req.id,
      },
    };
    res.status(429).json(body);
  },
});

/** Limits account creation per client IP. */
export const registrationRateLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: config.rateLimit.registrationPerHour,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    const body: ApiErrorBody = {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many registrations from this network. Please try again later.',
        requestId: req.id,
      },
    };
    res.status(429).json(body);
  },
});

/** Protects the unauthenticated public endpoints from excessive polling (per client IP). */
export const publicRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.rateLimit.public.maxPerMinute,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    const body: ApiErrorBody = {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait and try again.',
        requestId: req.id,
      },
    };
    res.status(429).json(body);
  },
});
