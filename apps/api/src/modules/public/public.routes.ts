import { OPAQUE_REFERENCE_PATTERN, visitorReservationRequestSchema } from '@cpvts/shared';
import { Router } from 'express';
import { z } from 'zod';

import { requestMeta } from '../../lib/request-context.js';
import { publicRateLimiter, visitorReservationRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { receiptService } from '../parking/receipt.service.js';
import { visitorReservationService } from '../visitor/visitor-reservation.service.js';
import { publicService } from './public.service.js';

/**
 * Unauthenticated, read-only information for the public landing page.
 * Responses contain aggregates and block-level data only.
 */
export const publicRouter = Router();

publicRouter.use(publicRateLimiter);

publicRouter.get('/overview', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=15');
  res.status(200).json(await publicService.getOverview());
});

/**
 * "Park My Vehicle" for visitors, no account needed. The server picks the block and slot, holds
 * it for a few minutes and returns a session QR plus a token for this one reservation. It
 * creates no parking session: Security activates the arrival. Rate limited per IP.
 */
publicRouter.post(
  '/visitor-reservations',
  visitorReservationRateLimiter,
  validate({ body: visitorReservationRequestSchema }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res
      .status(201)
      .json(
        await visitorReservationService.create(
          req.body as Parameters<typeof visitorReservationService.create>[0],
          requestMeta(req),
        ),
      );
  },
);

/**
 * Receipt QR verification. The reference is an unguessable 256-bit token
 * printed only on the receipt; the response is a safe subset of the
 * authoritative record. Responses are never cached.
 */
publicRouter.get(
  '/receipts/:reference',
  validate({ params: z.object({ reference: z.string().regex(OPAQUE_REFERENCE_PATTERN) }) }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json(await receiptService.verify(String(req.params.reference)));
  },
);
