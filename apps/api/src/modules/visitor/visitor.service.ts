import type {
  CheckoutQuote,
  CreatePaymentResponse,
  ParkingSessionView,
  PaymentMethod,
  PaymentView,
  PortalLayoutResponse,
  ProcessPaymentResponse,
  ReceiptView,
  SessionTimelineResponse,
  VisitorAccessRequest,
  VisitorAccessResponse,
} from '@cpvts/shared';

import { config } from '../../config/index.js';
import { prisma } from '../../db/prisma.js';
import { campusHour } from '../../lib/campus-time.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { RequestMeta } from '../auth/auth.types.js';
import { tokenService } from '../auth/token.service.js';
import { checkoutService } from '../parking/checkout.service.js';
import type { ActorContext } from '../parking/operation-context.js';
import { parkingErrors } from '../parking/parking.errors.js';
import { toReceiptView, toSessionView } from '../parking/parking.mappers.js';
import { parkingRepository, SESSION_INCLUDE } from '../parking/parking.repository.js';
import { timelineService } from '../parking/timeline.service.js';
import { liveContext, trackingService } from '../parking/tracking.service.js';
import { toUserLayout } from '../portal/portal-layout.js';
import { assertPaymentOfSession } from '../portal/self-checkout.service.js';

/** A visitor has no account: the audit trail records the VISITOR channel instead of an actor. */
const asVisitor = (request: RequestMeta): ActorContext => ({
  actor: null,
  request,
  channel: 'VISITOR',
});

/** The one session the token grants — and only if it is a visitor session. */
const loadSession = async (sessionId: string) => {
  const session = await prisma.parkingSession.findUnique({
    where: { id: sessionId },
    include: SESSION_INCLUDE,
  });
  if (!session || session.ownerCategory !== 'VISITOR') throw accountErrors.visitorAccessDenied();
  return session;
};

/**
 * Lightweight visitor experience: no account, no registration. A visitor proves
 * they hold the parking slip (vehicle number + session number) and receives a
 * short-lived token for that single session. Checkout, payment and receipt use
 * the same fee engine and finalization as every other channel.
 */
export const visitorService = {
  async access(input: VisitorAccessRequest, request: RequestMeta): Promise<VisitorAccessResponse> {
    const session = await parkingRepository.findSessionByNumber(String(input.sessionNumber));
    // One answer for every mismatch, so neither number can be probed separately.
    const recentlyCompleted =
      session?.status === 'COMPLETED' &&
      session.exitAt !== null &&
      session.exitAt.getTime() > Date.now() - config.accounts.visitorAccessSeconds * 1000;
    if (
      !session ||
      session.ownerCategory !== 'VISITOR' ||
      session.vehicle.vehicleNumber !== String(input.vehicleNumber) ||
      !(session.status === 'ACTIVE' || recentlyCompleted)
    ) {
      throw accountErrors.visitorAccessDenied();
    }

    const { token, expiresAt } = tokenService.issueVisitorToken(session.id);
    await auditRepository.record({
      action: AUDIT_ACTIONS.visitorAccessGranted,
      entityType: AUDIT_ENTITY_TYPES.parkingSession,
      entityId: session.sessionNumber,
      metadata: { via: 'VISITOR' },
      request,
    });
    return {
      accessToken: token,
      expiresAt: expiresAt.toISOString(),
      session: toSessionView(session, await liveContext()),
    };
  },

  async session(sessionId: string): Promise<ParkingSessionView> {
    return toSessionView(await loadSession(sessionId), await liveContext());
  },

  async layout(sessionId: string): Promise<PortalLayoutResponse> {
    const session = await loadSession(sessionId);
    const map = await trackingService.getMap();
    return toUserLayout(map, session.status === 'ACTIVE' ? [session.slot.code] : []);
  },

  async timeline(sessionId: string): Promise<SessionTimelineResponse> {
    const session = await loadSession(sessionId);
    return timelineService.forSession(session.sessionNumber, { isOwner: true });
  },

  async quote(sessionId: string, request: RequestMeta): Promise<CheckoutQuote> {
    const { sessionNumber } = await loadSession(sessionId);
    return checkoutService.quote({ sessionNumber, exitHour: campusHour() }, asVisitor(request));
  },

  async createPayment(
    sessionId: string,
    method: PaymentMethod,
    request: RequestMeta,
  ): Promise<CreatePaymentResponse> {
    const { sessionNumber } = await loadSession(sessionId);
    return checkoutService.createPayment(
      { sessionNumber, exitHour: campusHour(), method },
      asVisitor(request),
    );
  },

  async processPayment(
    sessionId: string,
    paymentId: string,
    outcome: 'SUCCESS' | 'FAILURE',
    request: RequestMeta,
  ): Promise<ProcessPaymentResponse> {
    const { sessionNumber } = await loadSession(sessionId);
    await assertPaymentOfSession(paymentId, sessionNumber);
    return checkoutService.processPayment(
      paymentId,
      { sessionNumber, outcome },
      asVisitor(request),
    );
  },

  async cancelPayment(
    sessionId: string,
    paymentId: string,
    request: RequestMeta,
  ): Promise<PaymentView> {
    const { sessionNumber } = await loadSession(sessionId);
    await assertPaymentOfSession(paymentId, sessionNumber);
    return checkoutService.cancelPayment(paymentId, sessionNumber, asVisitor(request));
  },

  async receipt(sessionId: string): Promise<ReceiptView> {
    const session = await loadSession(sessionId);
    const receiptNumber = session.receipt?.receiptNumber;
    if (!receiptNumber) throw parkingErrors.receiptNotFound();
    const receipt = await parkingRepository.findReceiptByNumber(receiptNumber);
    if (!receipt) throw parkingErrors.receiptNotFound();
    return toReceiptView(receipt);
  },
};
