import { notificationListQuerySchema, VALIDATION_MESSAGES } from '@cpvts/shared';
import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../../lib/request-context.js';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { notificationService } from './notification.service.js';

const idParams = z.object({ id: z.uuid({ error: VALIDATION_MESSAGES.required }) });

/**
 * In-app notifications for every signed-in role: Students and Campus Staff (verification,
 * parking, receipts, notices), Security Staff (shift assignments) and administrators (cash
 * and shift alerts). Everyone sees and changes only their own.
 * (Parking users also have the same routes under `/portal/notifications`.)
 */
export const notificationRouter = Router();

notificationRouter.use(authenticate);

notificationRouter.get('/', validate({ query: notificationListQuerySchema }), async (req, res) => {
  res
    .status(200)
    .json(
      await notificationService.list(
        requireAuth(req).user.id,
        req.query as unknown as { unreadOnly: boolean; limit: number },
      ),
    );
});

notificationRouter.post('/read-all', async (req, res) => {
  res.status(200).json(await notificationService.markAllRead(requireAuth(req).user.id));
});

notificationRouter.post('/:id/read', validate({ params: idParams }), async (req, res) => {
  res
    .status(200)
    .json(await notificationService.markRead(requireAuth(req).user.id, String(req.params.id)));
});
