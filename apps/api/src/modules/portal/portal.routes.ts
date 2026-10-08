import {
  paginationSchema,
  parkCancelRequestSchema,
  parkConfirmRequestSchema,
  parkProposalRequestSchema,
  portalHistoryQuerySchema,
  profileUpdateSchema,
  registerVehicleRequestSchema,
  selfPaymentRequestSchema,
  selfProcessPaymentSchema,
  sessionNumberSchema,
  updateVehicleRequestSchema,
  verificationResubmissionSchema,
  VALIDATION_MESSAGES,
} from '@cpvts/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { requestMeta, requireAuth } from '../../lib/request-context.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { requireVerified } from '../../middleware/require-verified.js';
import { validate } from '../../middleware/validate.js';
import { registrationService } from '../accounts/registration.service.js';
import { notificationService } from '../notifications/notification.service.js';
import type { OperationContext } from '../parking/operation-context.js';
import { selfCheckoutService, type SessionAccess } from '../parking/self-checkout.service.js';
import { portalParkingService } from './park.service.js';
import { portalService } from './portal.service.js';
import { vehicleService } from './vehicle.service.js';

const context = (req: Request): OperationContext => ({
  actor: requireAuth(req).user,
  request: requestMeta(req),
});
const userId = (req: Request): string => requireAuth(req).user.id;

/** A parking user may act only on sessions of their own vehicles. */
const ownSession =
  (req: Request): SessionAccess =>
  async (sessionNumber) => {
    await portalService.getSession(userId(req), sessionNumber);
  };

const sessionParams = z.object({ sessionNumber: sessionNumberSchema });
const receiptParams = z.object({ receiptNumber: z.string().trim().toUpperCase().min(1).max(32) });
const vehicleParams = z.object({ vehicleId: z.uuid({ error: VALIDATION_MESSAGES.required }) });
const paymentParams = z.object({ paymentId: z.uuid({ error: VALIDATION_MESSAGES.required }) });
const notificationParams = z.object({
  notificationId: z.uuid({ error: VALIDATION_MESSAGES.required }),
});

/**
 * Student / Campus Staff portal. Every route needs a parking-user token.
 * Profile, re-submission and notifications work while verification is pending
 * or rejected; everything that shows parking data, parks a vehicle or pays
 * needs an approved account.
 */
export const portalRouter = Router();

portalRouter.use(authenticate, authorize('PARKING_USER'));

// --- Available to every parking user ----------------------------------------

portalRouter.get('/profile', async (req, res) => {
  res.status(200).json(await portalService.getProfile(userId(req)));
});

portalRouter.patch('/profile', validate({ body: profileUpdateSchema }), async (req, res) => {
  res.status(200).json(await portalService.updateProfile(req.body, context(req)));
});

portalRouter.post(
  '/verification/resubmit',
  validate({ body: verificationResubmissionSchema }),
  async (req, res) => {
    await registrationService.resubmit(req.body, context(req));
    res.status(200).json(await portalService.getProfile(userId(req)));
  },
);

portalRouter.get('/notifications', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).json(await notificationService.list(userId(req)));
});

portalRouter.post('/notifications/read-all', async (req, res) => {
  await notificationService.markAllRead(userId(req));
  res.status(204).end();
});

portalRouter.post(
  '/notifications/:notificationId/read',
  validate({ params: notificationParams }),
  async (req, res) => {
    await notificationService.markRead(userId(req), String(req.params.notificationId));
    res.status(204).end();
  },
);

// --- Verified accounts only -------------------------------------------------

portalRouter.use(requireVerified);

portalRouter.get('/overview', async (req, res) => {
  res.status(200).json(await portalService.getOverview(userId(req)));
});

portalRouter.get('/vehicles', async (req, res) => {
  res.status(200).json(await vehicleService.list(userId(req)));
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

// --- Park now: the allocation engine proposes, the user confirms ------------

portalRouter.post(
  '/parking/proposals',
  validate({ body: parkProposalRequestSchema }),
  async (req, res) => {
    const { vehicleId } = req.body as { vehicleId: string };
    res.set('Cache-Control', 'no-store');
    res.status(201).json(await portalParkingService.propose(vehicleId, context(req)));
  },
);

portalRouter.post(
  '/parking/confirm',
  validate({ body: parkConfirmRequestSchema }),
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(201).json(await portalParkingService.confirm(req.body, context(req)));
  },
);

portalRouter.post(
  '/parking/cancel',
  validate({ body: parkCancelRequestSchema }),
  async (req, res) => {
    await portalParkingService.cancel(req.body, context(req));
    res.status(204).end();
  },
);

// --- Sessions, checkout and payment ------------------------------------------

portalRouter.get('/sessions/current', async (req, res) => {
  res.status(200).json(await portalService.listActiveSessions(userId(req)));
});

portalRouter.get(
  '/sessions/:sessionNumber',
  validate({ params: sessionParams }),
  async (req, res) => {
    res
      .status(200)
      .json(await portalService.getSession(userId(req), String(req.params.sessionNumber)));
  },
);

portalRouter.get(
  '/sessions/:sessionNumber/timeline',
  validate({ params: sessionParams }),
  async (req, res) => {
    res
      .status(200)
      .json(await portalService.getTimeline(userId(req), String(req.params.sessionNumber)));
  },
);

portalRouter.post(
  '/sessions/:sessionNumber/checkout',
  validate({ params: sessionParams }),
  async (req, res) => {
    res
      .status(200)
      .json(
        await selfCheckoutService.quote(
          String(req.params.sessionNumber),
          ownSession(req),
          context(req),
        ),
      );
  },
);

portalRouter.post(
  '/sessions/:sessionNumber/payments',
  validate({ params: sessionParams, body: selfPaymentRequestSchema }),
  async (req, res) => {
    const { method } = req.body as z.infer<typeof selfPaymentRequestSchema>;
    res
      .status(201)
      .json(
        await selfCheckoutService.createPayment(
          String(req.params.sessionNumber),
          method,
          ownSession(req),
          context(req),
        ),
      );
  },
);

portalRouter.post(
  '/payments/:paymentId/process',
  validate({ params: paymentParams, body: selfProcessPaymentSchema }),
  async (req, res) => {
    const { outcome } = req.body as z.infer<typeof selfProcessPaymentSchema>;
    res
      .status(200)
      .json(
        await selfCheckoutService.processPayment(
          String(req.params.paymentId),
          outcome,
          ownSession(req),
          context(req),
        ),
      );
  },
);

portalRouter.post(
  '/payments/:paymentId/cancel',
  validate({ params: paymentParams }),
  async (req, res) => {
    const payment = await selfCheckoutService.cancelPayment(
      String(req.params.paymentId),
      ownSession(req),
      context(req),
    );
    res.status(200).json({ payment });
  },
);

portalRouter.get('/layout', async (req, res) => {
  res.status(200).json(await portalService.getLayout(userId(req)));
});

portalRouter.get('/history', validate({ query: portalHistoryQuerySchema }), async (req, res) => {
  res.status(200).json(await portalService.listHistory(userId(req), req.query));
});

portalRouter.get('/receipts', validate({ query: paginationSchema }), async (req, res) => {
  const { page, pageSize } = req.query as unknown as z.infer<typeof paginationSchema>;
  res.status(200).json(await portalService.listReceipts(userId(req), page, pageSize));
});

portalRouter.get(
  '/receipts/:receiptNumber',
  validate({ params: receiptParams }),
  async (req, res) => {
    res
      .status(200)
      .json(await portalService.getReceipt(userId(req), String(req.params.receiptNumber)));
  },
);
