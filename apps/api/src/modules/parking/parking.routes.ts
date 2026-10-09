import {
  activeSessionsQuerySchema,
  adjustSessionTimeRequestSchema,
  arrivalLookupRequestSchema,
  releaseSlotReservationRequestSchema,
  reserveSlotRequestSchema,
  vipCheckInRequestSchema,
  cancelPaymentRequestSchema,
  checkInRequestSchema,
  checkoutQuoteRequestSchema,
  codeCheckoutRequestSchema,
  createPaymentRequestSchema,
  processPaymentRequestSchema,
  scanCheckoutRequestSchema,
  sessionNumberSchema,
  trackingQuerySchema,
  vehicleLookupQuerySchema,
  VALIDATION_MESSAGES,
} from '@cpvts/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';

import { requestMeta, requireAuth } from '../../lib/request-context.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { exitCodeRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { gateOperation, resolveOperator } from '../shifts/shift-access.js';
import { alertsService } from './alerts.service.js';
import { checkInService } from './check-in.service.js';
import { checkoutService } from './checkout.service.js';
import { exitCodeService } from './exit-code.service.js';
import { exitTimeService } from './exit-time.service.js';
import type { OperationContext } from './operation-context.js';
import { qrCheckoutService } from './qr-checkout.service.js';
import { receiptService } from './receipt.service.js';
import { timelineService } from './timeline.service.js';
import { trackingService } from './tracking.service.js';
import { vehicleLookupService } from './vehicle-lookup.service.js';
import { vipReservationService } from './vip-reservation.service.js';
import { visitorArrivalService } from './visitor-arrival.service.js';

/**
 * Who is acting and, for gate operations, under which duty shift (set by `resolveOperator`).
 * An administrator acts as an override with no shift.
 */
const context = (req: Request): OperationContext => ({
  actor: requireAuth(req).user,
  request: requestMeta(req),
  shiftId: req.operator?.shift?.id ?? null,
  override: req.operator?.override ?? false,
});

const sessionParams = z.object({ sessionNumber: sessionNumberSchema });
const paymentParams = z.object({ paymentId: z.uuid({ error: VALIDATION_MESSAGES.required }) });
const receiptParams = z.object({
  receiptNumber: z.string().trim().toUpperCase().min(1).max(32),
});

/**
 * Core parking operations. Every route requires sign-in.
 *
 * Vehicle entry belongs to Security Staff. Final checkout is gate-controlled: Security Staff
 * complete it (an administrator can too, as an override); a Student, Campus Staff member or
 * Visitor can only prepare to leave through their own routes. Entry and payments need an
 * on-duty shift while `SHIFT_ENFORCEMENT=required`. Administrators otherwise have read access
 * to tracking, the map, sessions and receipts.
 */
export const parkingRouter = Router();

parkingRouter.use(authenticate);

const security = authorize('SECURITY_STAFF');
const anyRole = authorize('SECURITY_STAFF', 'ADMIN');

parkingRouter.post(
  '/check-ins',
  security,
  ...gateOperation,
  validate({ body: checkInRequestSchema }),
  async (req, res) => {
    res.status(201).json(await checkInService.checkIn(req.body, context(req)));
  },
);

// --- VIP / emergency slot reservations ------------------------------------------------
// Security keeps one specific slot for an official guest or an emergency. Administrators can view
// the reservations and their history; only Security reserves, releases or checks the VIP in.

parkingRouter.get('/vip-reservations', anyRole, async (req, res) => {
  res.status(200).json(await vipReservationService.list(req.query.history === 'true'));
});

parkingRouter.post(
  '/vip-reservations',
  security,
  validate({ body: reserveSlotRequestSchema }),
  async (req, res) => {
    res
      .status(201)
      .json(
        await vipReservationService.reserve(
          req.body as Parameters<typeof vipReservationService.reserve>[0],
          context(req),
        ),
      );
  },
);

const vipParams = z.object({ id: z.uuid({ error: VALIDATION_MESSAGES.required }) });

parkingRouter.post(
  '/vip-reservations/:id/release',
  security,
  validate({ params: vipParams, body: releaseSlotReservationRequestSchema }),
  async (req, res) => {
    res
      .status(200)
      .json(
        await vipReservationService.release(String(req.params.id), req.body, context(req)),
      );
  },
);

parkingRouter.post(
  '/vip-reservations/:id/check-in',
  security,
  ...gateOperation,
  validate({ params: vipParams, body: vipCheckInRequestSchema }),
  async (req, res) => {
    res
      .status(201)
      .json(
        await vipReservationService.checkIn(
          String(req.params.id),
          req.body as Parameters<typeof vipReservationService.checkIn>[1],
          context(req),
        ),
      );
  },
);

// --- Visitor arrivals ---------------------------------------------------------------
// A visitor reserved a space through the public "Park My Vehicle" request. Security verifies the
// arrival and activates it: only then does a parking session (and its timer) start.

parkingRouter.get('/arrivals/pending', security, async (_req, res) => {
  res.status(200).json(await visitorArrivalService.pending());
});

parkingRouter.post(
  '/arrivals/find',
  security,
  validate({ body: arrivalLookupRequestSchema }),
  async (req, res) => {
    res.status(200).json(await visitorArrivalService.find(req.body, context(req)));
  },
);

parkingRouter.post(
  '/arrivals/:reservationId/activate',
  security,
  ...gateOperation,
  validate({ params: z.object({ reservationId: z.uuid({ error: VALIDATION_MESSAGES.required }) }) }),
  async (req, res) => {
    res
      .status(201)
      .json(await visitorArrivalService.activate(String(req.params.reservationId), context(req)));
  },
);

/**
 * Entry desk: is the plate known, and does a verified account fix its owner
 * category? Reveals no personal details of the owner.
 */
parkingRouter.get(
  '/vehicle-lookup',
  anyRole,
  validate({ query: vehicleLookupQuerySchema }),
  async (req, res) => {
    const { vehicleNumber } = req.query as unknown as z.infer<typeof vehicleLookupQuerySchema>;
    res.status(200).json(await vehicleLookupService.lookup(vehicleNumber));
  },
);

parkingRouter.get('/map', anyRole, async (_req, res) => {
  res.status(200).json(await trackingService.getMap());
});

parkingRouter.get('/alerts', anyRole, async (_req, res) => {
  res.status(200).json(await alertsService.list());
});

parkingRouter.get(
  '/sessions/:sessionNumber/timeline',
  anyRole,
  validate({ params: sessionParams }),
  async (req, res) => {
    res.status(200).json(await timelineService.forSession(String(req.params.sessionNumber)));
  },
);

/** Everyone parked now; `?exitRequested=true` lists those who said they are ready to leave. */
parkingRouter.get(
  '/sessions/active',
  anyRole,
  validate({ query: activeSessionsQuerySchema }),
  async (req, res) => {
    const { exitRequested } = req.query as unknown as z.infer<typeof activeSessionsQuerySchema>;
    res.status(200).json(await trackingService.listActive({ exitRequested }));
  },
);

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

// --- Gate checkout ----------------------------------------------------------------

/**
 * Camera checkout: the scanned session QR in, the verified ACTIVE session out. The QR alone
 * completes nothing — the quote, payment and finalization below are separate authorized steps.
 */
parkingRouter.post(
  '/checkouts/scan',
  anyRole,
  validate({ body: scanCheckoutRequestSchema }),
  async (req, res) => {
    const { qr } = req.body as z.infer<typeof scanCheckoutRequestSchema>;
    res.status(200).json(await qrCheckoutService.scan(qr, context(req)));
  },
);

/**
 * Fallback to the camera: the 6-digit exit code shown in the owner's or visitor's app. It
 * returns the same verified ACTIVE session a QR scan does and likewise completes nothing.
 */
parkingRouter.post(
  '/checkouts/code',
  anyRole,
  exitCodeRateLimiter,
  validate({ body: codeCheckoutRequestSchema }),
  async (req, res) => {
    const { code } = req.body as z.infer<typeof codeCheckoutRequestSchema>;
    res.status(200).json(await exitCodeService.resolve(code, context(req)));
  },
);

parkingRouter.post(
  '/checkouts/quote',
  anyRole,
  validate({ body: checkoutQuoteRequestSchema }),
  async (req, res) => {
    res.status(200).json(await checkoutService.quote(req.body, context(req)));
  },
);

/**
 * Security's audited correction of a session's entry and exit time before the final checkout.
 * The reply is the session priced afresh from the corrected times; the client never supplies a fee.
 */
parkingRouter.post(
  '/sessions/:sessionNumber/adjust-time',
  anyRole,
  ...gateOperation,
  validate({ params: sessionParams, body: adjustSessionTimeRequestSchema }),
  async (req, res) => {
    const { sessionNumber } = req.params as z.infer<typeof sessionParams>;
    const operation = context(req);
    await exitTimeService.adjust(
      sessionNumber,
      req.body as z.infer<typeof adjustSessionTimeRequestSchema>,
      operation,
    );
    const quote = await checkoutService.quote({ sessionNumber }, operation, { record: false });
    res.status(200).json({ quote });
  },
);

parkingRouter.post(
  '/payments',
  anyRole,
  ...gateOperation,
  validate({ body: createPaymentRequestSchema }),
  async (req, res) => {
    res.status(201).json(await checkoutService.createPayment(req.body, context(req)));
  },
);

// A payment already started keeps its shift even if the guard's shift has ended since.
parkingRouter.post(
  '/payments/:paymentId/process',
  anyRole,
  resolveOperator,
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
  anyRole,
  resolveOperator,
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
