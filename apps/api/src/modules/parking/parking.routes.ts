import {
  cancelPaymentRequestSchema,
  checkInRequestSchema,
  checkoutQuoteRequestSchema,
  createPaymentRequestSchema,
  processPaymentRequestSchema,
  sessionNumberSchema,
  trackingQuerySchema,
  VALIDATION_MESSAGES,
} from '@cpvts/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { requestMeta, requireAuth } from '../../lib/request-context.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { checkInService } from './check-in.service.js';
import { checkoutService } from './checkout.service.js';
import type { OperationContext } from './operation-context.js';
import { receiptService } from './receipt.service.js';
import { trackingService } from './tracking.service.js';

const context = (req: Request): OperationContext => ({
  actor: requireAuth(req).user,
  request: requestMeta(req),
});

const sessionParams = z.object({ sessionNumber: sessionNumberSchema });
const paymentParams = z.object({ paymentId: z.uuid({ error: VALIDATION_MESSAGES.required }) });
const receiptParams = z.object({
  receiptNumber: z.string().trim().toUpperCase().min(1).max(32),
});

/**
 * Core parking operations (Phase 2). Every route requires sign-in.
 * Operations that change state are for Security Staff; administrators have
 * read-only access to tracking, the map, sessions and receipts.
 */
export const parkingRouter = Router();

parkingRouter.use(authenticate);

const operator = authorize('SECURITY_STAFF');
const anyRole = authorize('SECURITY_STAFF', 'ADMIN');

parkingRouter.post(
  '/check-ins',
  operator,
  validate({ body: checkInRequestSchema }),
  async (req, res) => {
    res.status(201).json(await checkInService.checkIn(req.body, context(req)));
  },
);

parkingRouter.get('/map', anyRole, async (_req, res) => {
  res.status(200).json(await trackingService.getMap());
});

parkingRouter.get('/sessions/active', anyRole, async (_req, res) => {
  res.status(200).json(await trackingService.listActive());
});

parkingRouter.get(
  '/sessions/:sessionNumber',
  anyRole,
  validate({ params: sessionParams }),
  async (req, res) => {
    res.status(200).json(await trackingService.getSession(String(req.params.sessionNumber)));
  },
);

parkingRouter.get(
  '/tracking',
  anyRole,
  validate({ query: trackingQuerySchema }),
  async (req, res) => {
    const { q } = req.query as unknown as z.infer<typeof trackingQuerySchema>;
    res.status(200).json(await trackingService.search(q, context(req)));
  },
);

parkingRouter.post(
  '/checkouts/quote',
  operator,
  validate({ body: checkoutQuoteRequestSchema }),
  async (req, res) => {
    res.status(200).json(await checkoutService.quote(req.body, context(req)));
  },
);

parkingRouter.post(
  '/payments',
  operator,
  validate({ body: createPaymentRequestSchema }),
  async (req, res) => {
    res.status(201).json(await checkoutService.createPayment(req.body, context(req)));
  },
);

parkingRouter.post(
  '/payments/:paymentId/process',
  operator,
  validate({ params: paymentParams, body: processPaymentRequestSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(
        await checkoutService.processPayment(String(req.params.paymentId), req.body, context(req)),
      );
  },
);

parkingRouter.post(
  '/payments/:paymentId/cancel',
  operator,
  validate({ params: paymentParams, body: cancelPaymentRequestSchema }),
  async (req, res) => {
    const payment = await checkoutService.cancelPayment(
      String(req.params.paymentId),
      (req.body as { sessionNumber: string }).sessionNumber,
      context(req),
    );
    res.status(200).json({ payment });
  },
);

parkingRouter.get(
  '/receipts/:receiptNumber',
  anyRole,
  validate({ params: receiptParams }),
  async (req, res) => {
    res.status(200).json(await receiptService.getByNumber(String(req.params.receiptNumber)));
  },
);
