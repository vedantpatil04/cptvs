import {
  analyticsQuerySchema,
  auditLogQuerySchema,
  blockLocationRequestSchema,
  blockSlotRequestSchema,
  historyFilterSchema,
  historyQuerySchema,
  REPORT_KINDS,
  slotPriorityRequestSchema,
  type HistoryFilters,
  type ReportKind,
} from '@cpvts/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { requestMeta, requireAuth } from '../../lib/request-context.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import type { OperationContext } from '../parking/operation-context.js';
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
