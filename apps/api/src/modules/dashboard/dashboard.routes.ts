import { Router } from 'express';

import { requireAuth } from '../../lib/request-context.js';
import { authenticate } from '../../middleware/authenticate.js';
import { dashboardService } from './dashboard.service.js';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

dashboardRouter.get('/summary', async (req, res) => {
  res.status(200).json(await dashboardService.getSummary(requireAuth(req).user.role));
});
