import {
  VALIDATION_MESSAGES,
  visitorAccessRequestSchema,
  visitorPaymentRequestSchema,
  visitorProcessRequestSchema,
} from '@cpvts/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { requestMeta } from '../../lib/request-context.js';
import { unauthenticated } from '../../lib/errors.js';
import { authenticateVisitor } from '../../middleware/authenticate-visitor.js';
import { visitorAccessRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { visitorService } from './visitor.service.js';

const sessionId = (req: Request): string => {
  if (!req.visitor) throw unauthenticated();
  return req.visitor.sessionId;
};

const paymentParams = z.object({ paymentId: z.uuid({ error: VALIDATION_MESSAGES.required }) });

/**
 * Visitor API. Visitors have no account: `POST /access` exchanges the vehicle
 * number and session number from the parking slip for a short-lived token bound
 * to that one session, and every other route uses only that token.
 */
export const visitorRouter = Router();

visitorRouter.post(
  '/access',
  visitorAccessRateLimiter,
  validate({ body: visitorAccessRequestSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(
        await visitorService.access(
          req.body as z.infer<typeof visitorAccessRequestSchema>,
          requestMeta(req),
        ),
      );
  },
);

visitorRouter.use(authenticateVisitor);

visitorRouter.get('/session', async (req, res) => {
  res.status(200).json(await visitorService.session(sessionId(req)));
});

visitorRouter.get('/layout', async (req, res) => {
  res.status(200).json(await visitorService.layout(sessionId(req)));
});

visitorRouter.get('/timeline', async (req, res) => {
  res.status(200).json(await visitorService.timeline(sessionId(req)));
});

visitorRouter.post('/checkout/quote', async (req, res) => {
  res.status(200).json(await visitorService.quote(sessionId(req), requestMeta(req)));
});

visitorRouter.post(
  '/checkout/payments',
  validate({ body: visitorPaymentRequestSchema }),
  async (req, res) => {
    const { method } = req.body as z.infer<typeof visitorPaymentRequestSchema>;
    res
      .status(201)
      .json(await visitorService.createPayment(sessionId(req), method, requestMeta(req)));
  },
);

visitorRouter.post(
  '/checkout/payments/:paymentId/process',
  validate({ params: paymentParams, body: visitorProcessRequestSchema }),
  async (req, res) => {
    const { outcome } = req.body as z.infer<typeof visitorProcessRequestSchema>;
    res
      .status(200)
      .json(
        await visitorService.processPayment(
          sessionId(req),
          String(req.params.paymentId),
          outcome,
          requestMeta(req),
        ),
      );
  },
);

visitorRouter.post(
  '/checkout/payments/:paymentId/cancel',
  validate({ params: paymentParams }),
  async (req, res) => {
    res.status(200).json({
      payment: await visitorService.cancelPayment(
        sessionId(req),
        String(req.params.paymentId),
        requestMeta(req),
      ),
    });
  },
);

visitorRouter.get('/receipt', async (req, res) => {
  res.status(200).json(await visitorService.receipt(sessionId(req)));
});
