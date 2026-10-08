import {
  adminUserUpdateSchema,
  historyQuerySchema,
  paginationSchema,
  sendNoticeRequestSchema,
  userListQuerySchema,
  userStatusRequestSchema,
  VALIDATION_MESSAGES,
  verificationDecisionSchema,
  type HistoryFilters,
} from '@cpvts/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { requestMeta, requireAuth } from '../../lib/request-context.js';
import { validate } from '../../middleware/validate.js';
import { historyService } from '../management/history.service.js';
import { notificationService } from '../notifications/notification.service.js';
import type { OperationContext } from '../parking/operation-context.js';
import { adminUserService } from './admin-user.service.js';

const context = (req: Request): OperationContext => ({
  actor: requireAuth(req).user,
  request: requestMeta(req),
});

const userParams = z.object({ id: z.uuid({ error: VALIDATION_MESSAGES.required }) });
const documentParams = userParams.extend({
  documentId: z.uuid({ error: VALIDATION_MESSAGES.required }),
});

/**
 * Administrator user management (mounted under `/admin`, which already
 * requires the ADMIN role): Students, Campus Staff, verification and visitors.
 */
export const adminUsersRouter = Router();

adminUsersRouter.get('/users', validate({ query: userListQuerySchema }), async (req, res) => {
  res
    .status(200)
    .json(
      await adminUserService.list(req.query as unknown as z.output<typeof userListQuerySchema>),
    );
});

adminUsersRouter.get('/users/counts', async (_req, res) => {
  res.status(200).json(await adminUserService.counts());
});

adminUsersRouter.get('/users/:id', validate({ params: userParams }), async (req, res) => {
  res.status(200).json(await adminUserService.detail(String(req.params.id)));
});

adminUsersRouter.patch(
  '/users/:id',
  validate({ params: userParams, body: adminUserUpdateSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(await adminUserService.update(String(req.params.id), req.body, context(req)));
  },
);

adminUsersRouter.post(
  '/users/:id/status',
  validate({ params: userParams, body: userStatusRequestSchema }),
  async (req, res) => {
    const { isActive } = req.body as z.infer<typeof userStatusRequestSchema>;
    res
      .status(200)
      .json(await adminUserService.setActive(String(req.params.id), isActive, context(req)));
  },
);

adminUsersRouter.post(
  '/users/:id/verification',
  validate({ params: userParams, body: verificationDecisionSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(await adminUserService.decide(String(req.params.id), req.body, context(req)));
  },
);

/** Identity documents: private, one at a time, audited, never cached. */
adminUsersRouter.get(
  '/users/:id/documents/:documentId',
  validate({ params: documentParams }),
  async (req, res) => {
    const document = await adminUserService.readDocument(
      String(req.params.id),
      String(req.params.documentId),
      context(req),
    );
    res
      .status(200)
      .set({
        'Content-Type': document.mimeType,
        'Content-Length': String(document.content.length),
        'Content-Disposition': `inline; filename="${encodeURIComponent(document.fileName)}"`,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      })
      .send(document.content);
  },
);

adminUsersRouter.get(
  '/users/:id/history',
  validate({ params: userParams, query: paginationSchema }),
  async (req, res) => {
    const { page, pageSize } = req.query as unknown as z.infer<typeof paginationSchema>;
    res.status(200).json(await adminUserService.history(String(req.params.id), page, pageSize));
  },
);

/** Visitors have no accounts: they are listed from their parking sessions. */
adminUsersRouter.get('/visitors', validate({ query: historyQuerySchema }), async (req, res) => {
  const { page, pageSize, ...filters } = req.query as unknown as z.infer<typeof historyQuerySchema>;
  res
    .status(200)
    .json(
      await historyService.list(
        { ...filters, ownerCategory: 'VISITOR' } as HistoryFilters,
        page,
        pageSize,
      ),
    );
});

adminUsersRouter.post('/notices', validate({ body: sendNoticeRequestSchema }), async (req, res) => {
  res.status(201).json(await notificationService.sendNotice(req.body, context(req)));
});
