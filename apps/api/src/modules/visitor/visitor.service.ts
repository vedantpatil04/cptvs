import type {
  CheckoutQuote,
  ExitCodeResponse,
  ExitRequestState,
  ParkingSessionView,
  PortalLayoutResponse,
  ReceiptView,
  SessionTimelineResponse,
  VisitorAccessRequest,
  VisitorAccessResponse,
} from '@cpvts/shared';

import { config } from '../../config/index.js';
import { prisma } from '../../db/prisma.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { RequestMeta } from '../auth/auth.types.js';
import { tokenService } from '../auth/token.service.js';
import { checkoutService } from '../parking/checkout.service.js';
import { exitCodeService } from '../parking/exit-code.service.js';
import { exitRequestService } from '../parking/exit-request.service.js';
import type { ActorContext } from '../parking/operation-context.js';
import { parkingErrors } from '../parking/parking.errors.js';
import { toReceiptView, toSessionView } from '../parking/parking.mappers.js';
import { parkingRepository, SESSION_INCLUDE } from '../parking/parking.repository.js';
import { timelineService } from '../parking/timeline.service.js';
import { liveContext, trackingService } from '../parking/tracking.service.js';
import { toUserLayout } from '../portal/portal-layout.js';

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
 * short-lived token for that single session. They can see the session, the current
 * amount and say they are ready to leave, and open the receipt afterwards; the checkout
 * itself — payment, completion and receipt — is done at the exit gate by Security Staff,
 * with the same fee engine and finalization as every other session.
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

  /** A read-only preview of the amount due if the vehicle left now; nothing is recorded or reserved. */
  async quote(sessionId: string, request: RequestMeta): Promise<CheckoutQuote> {
    const { sessionNumber } = await loadSession(sessionId);
    return checkoutService.quote({ sessionNumber }, asVisitor(request), {
      record: false,
    });
  },

  /** "I am ready to leave" — a hint to the gate; the vehicle stays parked until the checkout. */
  async requestExit(sessionId: string, request: RequestMeta): Promise<ExitRequestState> {
    await loadSession(sessionId);
    return exitRequestService.request(sessionId, asVisitor(request));
  },

  /** A fresh 6-digit exit code for the gate when the session QR cannot be scanned. */
  async issueExitCode(sessionId: string, request: RequestMeta): Promise<ExitCodeResponse> {
    await loadSession(sessionId);
    return exitCodeService.issue(sessionId, asVisitor(request));
  },

  async cancelExitRequest(sessionId: string, request: RequestMeta): Promise<ExitRequestState> {
    await loadSession(sessionId);
    return exitRequestService.cancel(sessionId, asVisitor(request));
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
