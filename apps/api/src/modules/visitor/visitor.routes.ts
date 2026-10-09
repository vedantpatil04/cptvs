import { visitorAccessRequestSchema } from '@cpvts/shared';
import { Router, type Request } from 'express';
import type { z } from 'zod';

import { requestMeta } from '../../lib/request-context.js';
import { unauthenticated } from '../../lib/errors.js';
import { parkingErrors } from '../parking/parking.errors.js';
import { authenticateReservation } from '../../middleware/authenticate-reservation.js';
import { authenticateVisitor } from '../../middleware/authenticate-visitor.js';
import { visitorAccessRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { visitorReservationService } from './visitor-reservation.service.js';
import { visitorService } from './visitor.service.js';

const sessionId = (req: Request): string => {
  if (!req.visitor) throw unauthenticated();
  return req.visitor.sessionId;
};

/**
 * Visitor API. Visitors have no account: `POST /access` exchanges the vehicle
 * number and session number from the parking slip for a short-lived token bound
 * to that one session, and every other route uses only that token. The token reaches
 * that session and nothing else: no other user, no administration, no Security operations.
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

/**
 * The visitor's own reservation (created through the public "Park My Vehicle" request). The
 * reservation token reaches that one reservation only; once Security has activated the arrival
 * the status also carries a normal session token for everything below.
 */
visitorRouter.get('/reservation', authenticateReservation, async (req, res) => {
  const id = req.reservation?.reservationId;
  if (!id) throw unauthenticated();
  res.status(200).json(await visitorReservationService.status(id));
});

visitorRouter.delete('/reservation', authenticateReservation, async (req, res) => {
  const id = req.reservation?.reservationId;
  if (!id) throw unauthenticated();
  res.status(200).json(await visitorReservationService.cancel(id, requestMeta(req)));
});

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

/** A read-only preview of the amount due if the vehicle left now. */
visitorRouter.post('/checkout/quote', async (req, res) => {
  res.status(200).json(await visitorService.quote(sessionId(req), requestMeta(req)));
});

/** "I am ready to leave": tells the gate. The slot stays occupied until the gate checkout. */
visitorRouter.post('/exit-request', async (req, res) => {
  res.status(200).json(await visitorService.requestExit(sessionId(req), requestMeta(req)));
});

/** A fresh short-lived 6-digit code the gate can type if the session QR cannot be scanned. */
visitorRouter.post('/exit-code', async (req, res) => {
  res.status(201).json(await visitorService.issueExitCode(sessionId(req), requestMeta(req)));
});

visitorRouter.delete('/exit-request', async (req, res) => {
  res.status(200).json(await visitorService.cancelExitRequest(sessionId(req), requestMeta(req)));
});

/**
 * A visitor cannot pay or finalize remotely: the session is completed only by the exit
 * gate's checkout (payment, receipt, slot release). Old clients get a clear, stable answer.
 */
visitorRouter.all('/checkout/payments{/*splat}', () => {
  throw parkingErrors.gateCheckoutRequired();
});

visitorRouter.get('/receipt', async (req, res) => {
  res.status(200).json(await visitorService.receipt(sessionId(req)));
});
