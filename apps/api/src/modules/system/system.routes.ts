import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { systemService } from './system.service.js';

/** Operational information for administrators. */
export const systemRouter = Router();

systemRouter.use(authenticate, authorize('ADMIN'));

systemRouter.get('/status', async (_req, res) => {
  res.status(200).json(await systemService.getStatus());
});
