import {
  cancelPaymentRequestSchema,
  notificationListQuerySchema,
  paginationSchema,
  parkNowDecisionRequestSchema,
  parkNowStartRequestSchema,
  portalHistoryQuerySchema,
  processPaymentRequestSchema,
  profileUpdateSchema,
  registerVehicleRequestSchema,
  selfCheckoutQuoteRequestSchema,
  selfPaymentRequestSchema,
  sessionNumberSchema,
  updateVehicleRequestSchema,
  type VehiclesResponse,
  verificationResubmissionSchema,
  VALIDATION_MESSAGES,
} from '@cpvts/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { requestMeta, requireAuth } from '../../lib/request-context.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { registrationService } from '../accounts/registration.service.js';
import { notificationService } from '../notifications/notification.service.js';
import type { OperationContext } from '../parking/operation-context.js';
import { parkNowService } from './park-now.service.js';
import { requireVerified } from './portal-access.js';
import { portalService } from './portal.service.js';
import { profileService } from './profile.service.js';
import { selfCheckoutService } from './self-checkout.service.js';
import { vehicleService } from './vehicle.service.js';

const context = (req: Request): OperationContext => ({
  actor: requireAuth(req).user,
  request: requestMeta(req),
});

const userId = (req: Request): string => requireAuth(req).user.id;

const idParams = z.object({ id: z.uuid({ error: VALIDATION_MESSAGES.required }) });
const vehicleParams = z.object({ vehicleId: z.uuid({ error: VALIDATION_MESSAGES.required }) });
const sessionParams = z.object({ sessionNumber: sessionNumberSchema });
const paymentParams = z.object({ paymentId: z.uuid({ error: VALIDATION_MESSAGES.required }) });
const receiptParams = z.object({
  receiptNumber: z.string().trim().toUpperCase().min(1).max(32),
});

/**
 * Student / Campus Staff self-service API. Every route requires a
 * `PARKING_USER` account; everything except the profile, verification and
 * notifications also requires approved identity verification. All data is
 * scoped to the signed-in user's own vehicles and sessions on the server.
 */
export const portalRouter = Router();

portalRouter.use(authenticate, authorize('PARKING_USER'));

// --- Available while verification is pending or rejected -------------------

portalRouter.get('/profile', async (req, res) => {
  res.status(200).json(await profileService.get(userId(req)));
});

portalRouter.patch('/profile', validate({ body: profileUpdateSchema }), async (req, res) => {
  res.status(200).json(await profileService.update(req.body, context(req)));
});

portalRouter.post(
  '/verification/resubmit',
  validate({ body: verificationResubmissionSchema }),
  async (req, res) => {
    await registrationService.resubmit(req.body, context(req));
    res.status(200).json(await profileService.get(userId(req)));
  },
);

portalRouter.get(
  '/notifications',
  validate({ query: notificationListQuerySchema }),
  async (req, res) => {
    res
      .status(200)
      .json(
        await notificationService.list(
          userId(req),
          req.query as unknown as { unreadOnly: boolean; limit: number },
        ),
      );
  },
);

portalRouter.post('/notifications/read-all', async (req, res) => {
  res.status(200).json(await notificationService.markAllRead(userId(req)));
});

portalRouter.post('/notifications/:id/read', validate({ params: idParams }), async (req, res) => {
  res.status(200).json(await notificationService.markRead(userId(req), String(req.params.id)));
});

// --- Verified accounts only -------------------------------------------------

portalRouter.use(requireVerified);

portalRouter.get('/overview', async (req, res) => {
  res.status(200).json(await portalService.overview(userId(req)));
});

portalRouter.get('/layout', async (req, res) => {
  res.status(200).json(await portalService.layout(userId(req)));
});

// Vehicles

portalRouter.get('/vehicles', async (req, res) => {
  const body: VehiclesResponse = { vehicles: await vehicleService.list(userId(req)) };
  res.status(200).json(body);
});

portalRouter.post(
  '/vehicles',
  validate({ body: registerVehicleRequestSchema }),
  async (req, res) => {
    res.status(201).json(await vehicleService.register(req.body, context(req)));
  },
);

portalRouter.patch(
  '/vehicles/:vehicleId',
  validate({ params: vehicleParams, body: updateVehicleRequestSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(await vehicleService.update(String(req.params.vehicleId), req.body, context(req)));
  },
);

portalRouter.post(
  '/vehicles/:vehicleId/primary',
  validate({ params: vehicleParams }),
  async (req, res) => {
    res
      .status(200)
      .json(await vehicleService.setPrimary(String(req.params.vehicleId), context(req)));
  },
);

// Park Now

portalRouter.get('/park-now/offer', async (req, res) => {
  res.status(200).json(await parkNowService.current(context(req)));
});

portalRouter.post(
  '/park-now/offers',
  validate({ body: parkNowStartRequestSchema }),
  async (req, res) => {
    const { vehicleId } = req.body as z.infer<typeof parkNowStartRequestSchema>;
    res.status(201).json(await parkNowService.start(vehicleId, context(req)));
  },
);

portalRouter.post(
  '/park-now/confirm',
  validate({ body: parkNowDecisionRequestSchema }),
  async (req, res) => {
    const { offerId } = req.body as z.infer<typeof parkNowDecisionRequestSchema>;
    res.status(201).json(await parkNowService.confirm(offerId, context(req)));
  },
);

portalRouter.post(
  '/park-now/cancel',
  validate({ body: parkNowDecisionRequestSchema }),
  async (req, res) => {
    const { offerId } = req.body as z.infer<typeof parkNowDecisionRequestSchema>;
    await parkNowService.cancel(offerId, context(req));
    res.status(204).end();
  },
);

// Sessions

portalRouter.get('/sessions/active', async (req, res) => {
  res.status(200).json(await portalService.activeSessions(userId(req)));
});

portalRouter.get(
  '/sessions/:sessionNumber',
  validate({ params: sessionParams }),
  async (req, res) => {
    res
      .status(200)
      .json(await portalService.session(userId(req), String(req.params.sessionNumber)));
  },
);

portalRouter.get(
  '/sessions/:sessionNumber/timeline',
  validate({ params: sessionParams }),
  async (req, res) => {
    res
      .status(200)
      .json(await portalService.timeline(userId(req), String(req.params.sessionNumber)));
  },
);

// Checkout and payment

portalRouter.post(
  '/checkout/quote',
  validate({ body: selfCheckoutQuoteRequestSchema }),
  async (req, res) => {
    const { sessionNumber } = req.body as z.infer<typeof selfCheckoutQuoteRequestSchema>;
    res.status(200).json(await selfCheckoutService.quote(sessionNumber, context(req)));
  },
);

portalRouter.post(
  '/checkout/payments',
  validate({ body: selfPaymentRequestSchema }),
  async (req, res) => {
    const { sessionNumber, method } = req.body as z.infer<typeof selfPaymentRequestSchema>;
    res
      .status(201)
      .json(await selfCheckoutService.createPayment(sessionNumber, method, context(req)));
  },
);

portalRouter.post(
  '/checkout/payments/:paymentId/process',
  validate({ params: paymentParams, body: processPaymentRequestSchema }),
  async (req, res) => {
    const { sessionNumber, outcome } = req.body as z.infer<typeof processPaymentRequestSchema>;
    res
      .status(200)
      .json(
        await selfCheckoutService.processPayment(
          String(req.params.paymentId),
          sessionNumber,
          outcome,
          context(req),
        ),
      );
  },
);

portalRouter.post(
  '/checkout/payments/:paymentId/cancel',
  validate({ params: paymentParams, body: cancelPaymentRequestSchema }),
  async (req, res) => {
    const { sessionNumber } = req.body as z.infer<typeof cancelPaymentRequestSchema>;
    res.status(200).json({
      payment: await selfCheckoutService.cancelPayment(
        String(req.params.paymentId),
        sessionNumber,
        context(req),
      ),
    });
  },
);

// History and receipts

portalRouter.get('/history', validate({ query: portalHistoryQuerySchema }), async (req, res) => {
  res
    .status(200)
    .json(
      await portalService.history(
        userId(req),
        req.query as unknown as z.infer<typeof portalHistoryQuerySchema>,
      ),
    );
});

portalRouter.get('/receipts', validate({ query: paginationSchema }), async (req, res) => {
  res
    .status(200)
    .json(
      await portalService.receipts(
        userId(req),
        req.query as unknown as z.infer<typeof paginationSchema>,
      ),
    );
});

portalRouter.get(
  '/receipts/:receiptNumber',
  validate({ params: receiptParams }),
  async (req, res) => {
    res
      .status(200)
      .json(await portalService.receipt(userId(req), String(req.params.receiptNumber)));
  },
);
