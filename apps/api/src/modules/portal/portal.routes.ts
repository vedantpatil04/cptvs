import {
  notificationListQuerySchema,
  paginationSchema,
  parkNowDecisionRequestSchema,
  parkNowStartRequestSchema,
  portalHistoryQuerySchema,
  profileUpdateSchema,
  registerVehicleRequestSchema,
  selfCheckoutQuoteRequestSchema,
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
import { accountStateService } from '../accounts/account-state.js';
import { registrationService } from '../accounts/registration.service.js';
import { parkingErrors } from '../parking/parking.errors.js';
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
const receiptParams = z.object({
  receiptNumber: z.string().trim().toUpperCase().min(1).max(32),
});

/**
 * Student / Campus Staff self-service API. Every route requires a
 * `PARKING_USER` account; everything except the account state, profile, verification
 * and notifications also requires approved identity verification (decided from the
 * database on each request, never from the token). All data is scoped to the signed-in
 * user's own vehicles and sessions on the server.
 *
 * Checkout is gate-controlled: from here a user can preview the amount due and say they are
 * ready to leave, but the payment and the completion of the session happen at the exit
 * through Security Staff.
 */
export const portalRouter = Router();

portalRouter.use(authenticate, authorize('PARKING_USER'));

// --- Available while verification is pending or rejected -------------------

/**
 * The one authoritative answer to "what may this account do right now?": verification,
 * Park Now eligibility and academic details, read from the database on this request.
 */
portalRouter.get('/account', async (req, res) => {
  res.status(200).json(await accountStateService.get(userId(req)));
});

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

/** Removes the vehicle from the account (not while it is parked). */
portalRouter.delete(
  '/vehicles/:vehicleId',
  validate({ params: vehicleParams }),
  async (req, res) => {
    res.status(200).json(await vehicleService.remove(String(req.params.vehicleId), context(req)));
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

// Preparing to leave. Checkout itself is gate-controlled.

/** A read-only preview of the amount due if the vehicle left now. Nothing is recorded or reserved. */
portalRouter.post(
  '/checkout/quote',
  validate({ body: selfCheckoutQuoteRequestSchema }),
  async (req, res) => {
    const { sessionNumber } = req.body as z.infer<typeof selfCheckoutQuoteRequestSchema>;
    res.status(200).json(await selfCheckoutService.quote(sessionNumber, context(req)));
  },
);

/** "I am ready to leave": tells the gate. The slot stays occupied until the gate checkout. */
portalRouter.post(
  '/sessions/:sessionNumber/exit-request',
  validate({ params: sessionParams }),
  async (req, res) => {
    res
      .status(200)
      .json(await selfCheckoutService.requestExit(String(req.params.sessionNumber), context(req)));
  },
);

portalRouter.delete(
  '/sessions/:sessionNumber/exit-request',
  validate({ params: sessionParams }),
  async (req, res) => {
    res
      .status(200)
      .json(
        await selfCheckoutService.cancelExitRequest(String(req.params.sessionNumber), context(req)),
      );
  },
);

/**
 * There is no self-service payment or finalization: a session is completed only by the exit
 * gate's checkout. A client still calling the old payment routes gets a clear, stable answer.
 */
portalRouter.all('/checkout/payments{/*splat}', () => {
  throw parkingErrors.gateCheckoutRequired();
});

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
