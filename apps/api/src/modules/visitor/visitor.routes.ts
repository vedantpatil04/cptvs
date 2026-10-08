import {
  selfPaymentRequestSchema,
  selfProcessPaymentSchema,
  VALIDATION_MESSAGES,
  visitorAccessRequestSchema,
} from '@cpvts/shared';
import { Router } from 'express';
import { z } from 'zod';

import { requestMeta } from '../../lib/request-context.js';
import { authenticateVisitor } from '../../middleware/authenticate-visitor.js';
import { visitorAccessRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { visitorService } from './visitor.service.js';

/**
 * Visitor access (no account). The token from `/access` is bound to one
 * parking session and works only on these routes.
 */
export const visitorRouter = Router();

visitorRouter.post(
  '/access',
  visitorAccessRateLimiter,
  validate({ body: visitorAccessRequestSchema }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json(await visitorService.grantAccess(req.body, requestMeta(req)));
  },
);

visitorRouter.use(authenticateVisitor);

visitorRouter.get('/session', async (req, res) => {
  res.status(200).json(await visitorService.getSession(req.visitor!.sessionId));
});

visitorRouter.get('/receipt', async (req, res) => {
  res.status(200).json(await visitorService.getReceipt(req.visitor!.sessionId));
});

visitorRouter.get('/layout', async (req, res) => {
  res.status(200).json(await visitorService.getLayout(req.visitor!.sessionId));
});

const paymentParams = z.object({ paymentId: z.uuid({ error: VALIDATION_MESSAGES.required }) });

// Checkout and simulated payment for the visitor's own session.

visitorRouter.post('/checkout', async (req, res) => {
  res.status(200).json(await visitorService.quote(req.visitor!.sessionId, requestMeta(req)));
});

visitorRouter.post('/payments', validate({ body: selfPaymentRequestSchema }), async (req, res) => {
  const { method } = req.body as z.infer<typeof selfPaymentRequestSchema>;
  res
    .status(201)
    .json(await visitorService.createPayment(req.visitor!.sessionId, method, requestMeta(req)));
});

visitorRouter.post(
  '/payments/:paymentId/process',
  validate({ params: paymentParams, body: selfProcessPaymentSchema }),
  async (req, res) => {
    const { outcome } = req.body as z.infer<typeof selfProcessPaymentSchema>;
    res
      .status(200)
      .json(
        await visitorService.processPayment(
          req.visitor!.sessionId,
          String(req.params.paymentId),
          outcome,
          requestMeta(req),
        ),
      );
  },
);

visitorRouter.post(
  '/payments/:paymentId/cancel',
  validate({ params: paymentParams }),
  async (req, res) => {
    const payment = await visitorService.cancelPayment(
      req.visitor!.sessionId,
      String(req.params.paymentId),
      requestMeta(req),
    );
    res.status(200).json({ payment });
  },
);
