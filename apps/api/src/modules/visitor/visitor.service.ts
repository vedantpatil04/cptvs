import type {
  CheckoutQuote,
  CreatePaymentResponse,
  ParkingSessionView,
  PaymentMethod,
  PaymentView,
  PortalLayoutResponse,
  ProcessPaymentResponse,
  ReceiptView,
  VisitorAccessRequest,
  VisitorAccessResponse,
} from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { RequestMeta } from '../auth/auth.types.js';
import { tokenService } from '../auth/token.service.js';
import { liveContext } from '../parking/live-context.js';
import { parkingErrors } from '../parking/parking.errors.js';
import { toReceiptView, toSessionView } from '../parking/parking.mappers.js';
import { RECEIPT_INCLUDE, SESSION_INCLUDE } from '../parking/parking.repository.js';
import { buildPortalLayout } from '../portal/portal.service.js';
import { selfCheckoutService, type SessionAccess } from '../parking/self-checkout.service.js';

/** The session a visitor token was issued for. A vanished session ends the access. */
const findGrantedSession = async (sessionId: string) => {
  const session = await prisma.parkingSession.findUnique({
    where: { id: sessionId },
    include: SESSION_INCLUDE,
  });
  if (!session || session.ownerCategory !== 'VISITOR') throw accountErrors.visitorAccessDenied();
  return session;
};

/**
 * Visitors have no account. They prove they hold the parking slip with the
 * vehicle number and session number printed on it, and receive a short-lived
 * token for that one session — nothing else.
 */
export const visitorService = {
  async grantAccess(
    input: VisitorAccessRequest,
    request: RequestMeta,
  ): Promise<VisitorAccessResponse> {
    const { vehicleNumber, sessionNumber } = input as {
      vehicleNumber: string;
      sessionNumber: string;
    };
    const session = await prisma.parkingSession.findUnique({
      where: { sessionNumber },
      include: SESSION_INCLUDE,
    });
    // Same answer for every failure, so nothing is revealed about other sessions.
    if (
      !session ||
      session.vehicle.vehicleNumber !== vehicleNumber ||
      session.ownerCategory !== 'VISITOR'
    ) {
      throw accountErrors.visitorAccessDenied();
    }

    const { token, expiresAt } = tokenService.issueVisitorToken(session.id);
    await auditRepository.record({
      action: AUDIT_ACTIONS.visitorAccessGranted,
      entityType: AUDIT_ENTITY_TYPES.parkingSession,
      entityId: session.sessionNumber,
      request,
    });
    return {
      accessToken: token,
      expiresAt: expiresAt.toISOString(),
      session: toSessionView(session, await liveContext()),
    };
  },

  async getSession(sessionId: string): Promise<ParkingSessionView> {
    return toSessionView(await findGrantedSession(sessionId), await liveContext());
  },

  async getReceipt(sessionId: string): Promise<ReceiptView> {
    const session = await findGrantedSession(sessionId);
    const receipt = await prisma.receipt.findUnique({
      where: { sessionId: session.id },
      include: RECEIPT_INCLUDE,
    });
    if (!receipt) throw parkingErrors.receiptNotFound();
    return toReceiptView(receipt);
  },

  async getLayout(sessionId: string): Promise<PortalLayoutResponse> {
    const session = await findGrantedSession(sessionId);
    return buildPortalLayout(session.status === 'ACTIVE' ? [session.slot.code] : []);
  },

  /** A visitor may act only on the session whose slip they hold. */
  accessTo(sessionId: string): SessionAccess {
    return async (sessionNumber) => {
      const session = await findGrantedSession(sessionId);
      if (session.sessionNumber !== sessionNumber) throw accountErrors.visitorAccessDenied();
    };
  },

  /** Checkout and (simulated) payment for the visitor's own session; no account is involved. */
  async quote(sessionId: string, request: RequestMeta): Promise<CheckoutQuote> {
    const session = await findGrantedSession(sessionId);
    return selfCheckoutService.quote(session.sessionNumber, this.accessTo(sessionId), {
      actor: null,
      request,
    });
  },

  async createPayment(
    sessionId: string,
    method: PaymentMethod,
    request: RequestMeta,
  ): Promise<CreatePaymentResponse> {
    const session = await findGrantedSession(sessionId);
    return selfCheckoutService.createPayment(
      session.sessionNumber,
      method,
      this.accessTo(sessionId),
      { actor: null, request },
    );
  },

  async processPayment(
    sessionId: string,
    paymentId: string,
    outcome: 'SUCCESS' | 'FAILURE',
    request: RequestMeta,
  ): Promise<ProcessPaymentResponse> {
    return selfCheckoutService.processPayment(paymentId, outcome, this.accessTo(sessionId), {
      actor: null,
      request,
    });
  },

  async cancelPayment(
    sessionId: string,
    paymentId: string,
    request: RequestMeta,
  ): Promise<PaymentView> {
    return selfCheckoutService.cancelPayment(paymentId, this.accessTo(sessionId), {
      actor: null,
      request,
    });
  },
};
