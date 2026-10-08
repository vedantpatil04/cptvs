import {
  analyticsQuerySchema,
  auditLogQuerySchema,
  blockLocationRequestSchema,
  blockSlotRequestSchema,
  createSlotRequestSchema,
  historyFilterSchema,
  historyQuerySchema,
  adminUserUpdateSchema,
  paginationSchema,
  portalHistoryQuerySchema,
  REPORT_KINDS,
  slotPriorityRequestSchema,
  updateBlockRequestSchema,
  updateSlotRequestSchema,
  updateZoneRequestSchema,
  userListQuerySchema,
  userStatusRequestSchema,
  verificationDecisionSchema,
  visitorListQuerySchema,
  VALIDATION_MESSAGES,
  type HistoryFilters,
  type ReportKind,
} from '@cpvts/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { requestMeta, requireAuth } from '../../lib/request-context.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { userAdminService } from '../accounts/user-admin.service.js';
import type { OperationContext } from '../parking/operation-context.js';
import { portalService } from '../portal/portal.service.js';
import { analyticsService } from './analytics.service.js';
import { auditLogService } from './audit-log.service.js';
import { historyService } from './history.service.js';
import { integrityService } from './integrity.service.js';
import { reportsService } from './reports.service.js';
import { slotManagementService } from './slot-management.service.js';

const context = (req: Request): OperationContext => ({
  actor: requireAuth(req).user,
  request: requestMeta(req),
});

const codeParams = z.object({ code: z.string().trim().toUpperCase().min(1).max(32) });
const reportParams = z.object({ kind: z.enum(REPORT_KINDS) });
const userParams = z.object({ userId: z.uuid({ error: VALIDATION_MESSAGES.required }) });
const documentParams = userParams.extend({
  documentId: z.uuid({ error: VALIDATION_MESSAGES.required }),
});

/** Administrator management (Phase 3). Every route requires the ADMIN role. */
export const adminRouter = Router();

adminRouter.use(authenticate, authorize('ADMIN'));

// --- Slot management -------------------------------------------------------

adminRouter.get('/layout', async (_req, res) => {
  res.status(200).json(await slotManagementService.getLayout());
});

adminRouter.post(
  '/slots/:code/block',
  validate({ params: codeParams, body: blockSlotRequestSchema }),
  async (req, res) => {
    const { reason } = req.body as z.infer<typeof blockSlotRequestSchema>;
    res
      .status(200)
      .json(await slotManagementService.block(String(req.params.code), reason, context(req)));
  },
);

adminRouter.post('/slots/:code/unblock', validate({ params: codeParams }), async (req, res) => {
  res.status(200).json(await slotManagementService.unblock(String(req.params.code), context(req)));
});

adminRouter.post('/slots', validate({ body: createSlotRequestSchema }), async (req, res) => {
  res.status(201).json(await slotManagementService.create(req.body, context(req)));
});

adminRouter.get(
  '/zones/:code/next-slot-code',
  validate({ params: codeParams }),
  async (req, res) => {
    res.status(200).json(await slotManagementService.nextCode(String(req.params.code)));
  },
);

adminRouter.patch(
  '/slots/:code',
  validate({ params: codeParams, body: updateSlotRequestSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(await slotManagementService.update(String(req.params.code), req.body, context(req)));
  },
);

adminRouter.post('/slots/:code/enable', validate({ params: codeParams }), async (req, res) => {
  res.status(200).json(await slotManagementService.enable(String(req.params.code), context(req)));
});

adminRouter.post('/slots/:code/disable', validate({ params: codeParams }), async (req, res) => {
  res.status(200).json(await slotManagementService.disable(String(req.params.code), context(req)));
});

adminRouter.delete('/slots/:code', validate({ params: codeParams }), async (req, res) => {
  res.status(200).json(await slotManagementService.remove(String(req.params.code), context(req)));
});

adminRouter.patch(
  '/blocks/:code',
  validate({ params: codeParams, body: updateBlockRequestSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(
        await slotManagementService.updateBlock(String(req.params.code), req.body, context(req)),
      );
  },
);

adminRouter.patch(
  '/zones/:code',
  validate({ params: codeParams, body: updateZoneRequestSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(
        await slotManagementService.updateZone(String(req.params.code), req.body, context(req)),
      );
  },
);

adminRouter.patch(
  '/slots/:code/priority',
  validate({ params: codeParams, body: slotPriorityRequestSchema }),
  async (req, res) => {
    const { priority } = req.body as z.infer<typeof slotPriorityRequestSchema>;
    res
      .status(200)
      .json(
        await slotManagementService.setPriority(String(req.params.code), priority, context(req)),
      );
  },
);

adminRouter.patch(
  '/blocks/:code/location',
  validate({ params: codeParams, body: blockLocationRequestSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(
        await slotManagementService.setBlockLocation(
          String(req.params.code),
          req.body as z.infer<typeof blockLocationRequestSchema>,
          context(req),
        ),
      );
  },
);

// --- History, reports, analytics -------------------------------------------

adminRouter.get('/history', validate({ query: historyQuerySchema }), async (req, res) => {
  const { page, pageSize, ...filters } = req.query as unknown as z.infer<typeof historyQuerySchema>;
  res.status(200).json(await historyService.list(filters, page, pageSize));
});

adminRouter.get(
  '/reports/:kind',
  validate({ params: reportParams, query: historyFilterSchema }),
  async (req, res) => {
    const report = await reportsService.export(
      req.params.kind as ReportKind,
      req.query as unknown as HistoryFilters,
      context(req),
    );
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${report.filename}"`,
        'Cache-Control': 'no-store',
      })
      .send(report.content);
  },
);

adminRouter.get('/analytics', validate({ query: analyticsQuerySchema }), async (req, res) => {
  const { date } = req.query as unknown as z.infer<typeof analyticsQuerySchema>;
  res.status(200).json(await analyticsService.forDate(date));
});

// --- Integrity and audit ---------------------------------------------------

adminRouter.get('/integrity', async (_req, res) => {
  res.status(200).json(await integrityService.scan());
});

adminRouter.get('/audit-logs', validate({ query: auditLogQuerySchema }), async (req, res) => {
  const { page, pageSize, ...filters } = req.query as unknown as z.infer<
    typeof auditLogQuerySchema
  >;
  res.status(200).json(await auditLogService.list(filters, page, pageSize));
});

// --- Users: students, staff, visitors ----------------------------------------

adminRouter.get('/users/counts', async (_req, res) => {
  res.status(200).json(await userAdminService.counts());
});

adminRouter.get('/users', validate({ query: userListQuerySchema }), async (req, res) => {
  const { page, pageSize, ...filters } = req.query as unknown as z.infer<
    typeof userListQuerySchema
  >;
  res.status(200).json(await userAdminService.list(filters, page, pageSize));
});

adminRouter.get('/visitors', validate({ query: visitorListQuerySchema }), async (req, res) => {
  const { page, pageSize, ...filters } = req.query as unknown as z.infer<
    typeof visitorListQuerySchema
  >;
  res.status(200).json(await userAdminService.listVisitors(filters, page, pageSize));
});

adminRouter.get('/users/:userId', validate({ params: userParams }), async (req, res) => {
  res.status(200).json(await userAdminService.detail(String(req.params.userId)));
});

adminRouter.patch(
  '/users/:userId',
  validate({ params: userParams, body: adminUserUpdateSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(await userAdminService.update(String(req.params.userId), req.body, context(req)));
  },
);

adminRouter.post(
  '/users/:userId/status',
  validate({ params: userParams, body: userStatusRequestSchema }),
  async (req, res) => {
    const { isActive } = req.body as z.infer<typeof userStatusRequestSchema>;
    res
      .status(200)
      .json(await userAdminService.setActive(String(req.params.userId), isActive, context(req)));
  },
);

adminRouter.post(
  '/users/:userId/verification',
  validate({ params: userParams, body: verificationDecisionSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(
        await userAdminService.decideVerification(
          String(req.params.userId),
          req.body,
          context(req),
        ),
      );
  },
);

/** Identity documents are served only here, to administrators, never cached or sniffed. */
adminRouter.get(
  '/users/:userId/documents/:documentId',
  validate({ params: documentParams }),
  async (req, res) => {
    const document = await userAdminService.readDocument(
      String(req.params.userId),
      String(req.params.documentId),
      context(req),
    );
    const asciiName = document.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res
      .status(200)
      .set({
        'Content-Type': document.mimeType,
        'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        'Content-Length': String(document.content.length),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      })
      .send(document.content);
  },
);

adminRouter.get(
  '/users/:userId/history',
  validate({ params: userParams, query: portalHistoryQuerySchema }),
  async (req, res) => {
    const userId = String(req.params.userId);
    await userAdminService.assertExists(userId);
    res.status(200).json(await portalService.listHistory(userId, req.query));
  },
);

adminRouter.get(
  '/users/:userId/receipts',
  validate({ params: userParams, query: paginationSchema }),
  async (req, res) => {
    const userId = String(req.params.userId);
    await userAdminService.assertExists(userId);
    const { page, pageSize } = req.query as unknown as z.infer<typeof paginationSchema>;
    res.status(200).json(await portalService.listReceipts(userId, page, pageSize));
  },
);
