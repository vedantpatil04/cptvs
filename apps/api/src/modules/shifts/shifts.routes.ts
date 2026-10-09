import {
  cashHandoverRequestSchema,
  cashSummaryQuerySchema,
  checkInShiftRequestSchema,
  createSecurityStaffRequestSchema,
  createShiftRequestSchema,
  createShiftTemplateRequestSchema,
  resetPasswordRequestSchema,
  resolveDiscrepancyRequestSchema,
  rosterQuerySchema,
  shiftListQuerySchema,
  updateShiftRequestSchema,
  updateShiftTemplateRequestSchema,
  VALIDATION_MESSAGES,
} from '@cpvts/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { requestMeta, requireAuth } from '../../lib/request-context.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import type { OperationContext } from '../parking/operation-context.js';
import { cashService } from './cash.service.js';
import { securityStaffService } from './security-staff.service.js';
import { shiftService } from './shift.service.js';

const context = (req: Request): OperationContext => ({
  actor: requireAuth(req).user,
  request: requestMeta(req),
});

const idParams = z.object({ id: z.uuid({ error: VALIDATION_MESSAGES.required }) });
const templatesQuery = z.object({
  includeInactive: z
    .preprocess((value) => value === true || value === 'true' || value === '1', z.boolean())
    .default(false),
});

/**
 * Administrator side of Security Staff duty: gate accounts, shift templates, the daily
 * roster, shift history and the cash each shift hands over. Mounted under `/admin`, which
 * already requires the ADMIN role.
 */
export const adminShiftsRouter = Router();

// --- Security Staff accounts ------------------------------------------------------

adminShiftsRouter.get('/security-staff', async (_req, res) => {
  res.status(200).json(await securityStaffService.list());
});

adminShiftsRouter.post(
  '/security-staff',
  validate({ body: createSecurityStaffRequestSchema }),
  async (req, res) => {
    res.status(201).json(await securityStaffService.create(req.body, context(req)));
  },
);

adminShiftsRouter.post(
  '/security-staff/:id/password',
  validate({ params: idParams, body: resetPasswordRequestSchema }),
  async (req, res) => {
    await securityStaffService.resetPassword(String(req.params.id), req.body, context(req));
    res.status(204).end();
  },
);

// --- Shift templates ----------------------------------------------------------------

adminShiftsRouter.get('/shift-templates', validate({ query: templatesQuery }), async (req, res) => {
  const { includeInactive } = req.query as unknown as z.infer<typeof templatesQuery>;
  res.status(200).json(await shiftService.listTemplates({ includeInactive }));
});

adminShiftsRouter.post(
  '/shift-templates',
  validate({ body: createShiftTemplateRequestSchema }),
  async (req, res) => {
    res.status(201).json(await shiftService.createTemplate(req.body, context(req)));
  },
);

adminShiftsRouter.patch(
  '/shift-templates/:id',
  validate({ params: idParams, body: updateShiftTemplateRequestSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(await shiftService.updateTemplate(String(req.params.id), req.body, context(req)));
  },
);

// --- Roster and shift history ------------------------------------------------------------

adminShiftsRouter.get(
  '/shifts/roster',
  validate({ query: rosterQuerySchema }),
  async (req, res) => {
    const { date } = req.query as unknown as z.infer<typeof rosterQuerySchema>;
    res.status(200).json(await shiftService.roster(date));
  },
);

adminShiftsRouter.get('/shifts', validate({ query: shiftListQuerySchema }), async (req, res) => {
  res
    .status(200)
    .json(await shiftService.list(req.query as unknown as z.output<typeof shiftListQuerySchema>));
});

adminShiftsRouter.post(
  '/shifts',
  validate({ body: createShiftRequestSchema }),
  async (req, res) => {
    res.status(201).json(await shiftService.assign(req.body, context(req)));
  },
);

adminShiftsRouter.get('/shifts/:id', validate({ params: idParams }), async (req, res) => {
  res.status(200).json(await shiftService.get(String(req.params.id)));
});

adminShiftsRouter.patch(
  '/shifts/:id',
  validate({ params: idParams, body: updateShiftRequestSchema }),
  async (req, res) => {
    res.status(200).json(await shiftService.update(String(req.params.id), req.body, context(req)));
  },
);

/** Removes a shift nobody has started. */
adminShiftsRouter.delete('/shifts/:id', validate({ params: idParams }), async (req, res) => {
  await shiftService.cancel(String(req.params.id), context(req));
  res.status(204).end();
});

/** Ends the duty of a guard who forgot to check out. */
adminShiftsRouter.post(
  '/shifts/:id/check-out',
  validate({ params: idParams }),
  async (req, res) => {
    res.status(200).json(await shiftService.adminCheckOut(String(req.params.id), context(req)));
  },
);

adminShiftsRouter.get(
  '/shifts/:id/transactions',
  validate({ params: idParams }),
  async (req, res) => {
    res.status(200).json(await cashService.transactions(String(req.params.id)));
  },
);

// --- Cash handover and reconciliation -----------------------------------------------------

/** The administrator counts the cash handed over; a difference needs a reason. */
adminShiftsRouter.post(
  '/shifts/:id/handover',
  validate({ params: idParams, body: cashHandoverRequestSchema }),
  async (req, res) => {
    res
      .status(201)
      .json(await cashService.recordHandover(String(req.params.id), req.body, context(req)));
  },
);

/** Reviews a cash difference; the shift then counts as closed. */
adminShiftsRouter.post(
  '/shifts/:id/handover/resolve',
  validate({ params: idParams, body: resolveDiscrepancyRequestSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(await cashService.resolveDiscrepancy(String(req.params.id), req.body, context(req)));
  },
);

adminShiftsRouter.get(
  '/cash/summary',
  validate({ query: cashSummaryQuerySchema }),
  async (req, res) => {
    res
      .status(200)
      .json(
        await cashService.overview(req.query as unknown as z.output<typeof cashSummaryQuerySchema>),
      );
  },
);

adminShiftsRouter.get('/cash/discrepancies', async (_req, res) => {
  res.status(200).json(await cashService.discrepancies());
});

/**
 * Security Staff side: the signed-in guard's own shift context ("Security 1 · 08:00–16:00 ·
 * Main Gate · ON DUTY"), check-in and check-out. Only Security Staff have shifts; an
 * administrator acts as an override and has none.
 */
export const securityRouter = Router();

securityRouter.use(authenticate, authorize('SECURITY_STAFF'));

securityRouter.get('/shift', async (req, res) => {
  res.status(200).json(await shiftService.mine(requireAuth(req).user.id));
});

securityRouter.post(
  '/shift/check-in',
  validate({ body: checkInShiftRequestSchema }),
  async (req, res) => {
    const { shiftId } = req.body as z.infer<typeof checkInShiftRequestSchema>;
    res
      .status(200)
      .json(await shiftService.checkIn(requireAuth(req).user.id, shiftId, context(req)));
  },
);

securityRouter.post('/shift/check-out', async (req, res) => {
  res.status(200).json(await shiftService.checkOut(requireAuth(req).user.id, context(req)));
});
