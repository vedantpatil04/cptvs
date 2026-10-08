import { Router } from 'express';

import { publicRateLimiter } from '../../middleware/rate-limit.js';
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
