import type { ExitRequestState } from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { channelMetadata, type ActorContext } from './operation-context.js';
import { parkingErrors } from './parking.errors.js';

/**
 * "Ready to leave": the owner or visitor tells the gate they are about to exit. It is a
 * flag on the ACTIVE session — nothing else changes: the slot stays occupied, no fee is
 * frozen and no payment is made. Only the gate checkout (QR or manual lookup, payment,
 * receipt) completes the session and releases the slot.
 */
const load = async (sessionId: string) => {
  const session = await prisma.parkingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, sessionNumber: true, status: true, exitRequestedAt: true },
  });
  if (!session) throw parkingErrors.sessionNotFound();
  return session;
};

const toState = (session: {
  sessionNumber: string;
  exitRequestedAt: Date | null;
}): ExitRequestState => ({
  sessionNumber: session.sessionNumber,
  exitRequestedAt: session.exitRequestedAt?.toISOString() ?? null,
});

export const exitRequestService = {
  /** Marks the session "ready to leave". Asking twice changes nothing. */
  async request(sessionId: string, context: ActorContext): Promise<ExitRequestState> {
    const session = await load(sessionId);
    if (session.status !== 'ACTIVE') throw parkingErrors.sessionNotActive();
    if (session.exitRequestedAt) return toState(session);

    const { count } = await prisma.parkingSession.updateMany({
      where: { id: session.id, status: 'ACTIVE', exitRequestedAt: null },
      data: { exitRequestedAt: new Date() },
    });
    if (count === 1) {
      await auditRepository.record({
        action: AUDIT_ACTIONS.exitRequested,
        actorId: context.actor?.id ?? null,
        entityType: AUDIT_ENTITY_TYPES.parkingSession,
        entityId: session.sessionNumber,
        metadata: channelMetadata(context),
        request: context.request,
      });
    }
    return toState(await load(sessionId));
  },

  /** Takes the flag back (the owner changed their mind). */
  async cancel(sessionId: string, context: ActorContext): Promise<ExitRequestState> {
    const session = await load(sessionId);
    if (session.status !== 'ACTIVE') throw parkingErrors.sessionNotActive();
    if (!session.exitRequestedAt) return toState(session);

    const { count } = await prisma.parkingSession.updateMany({
      where: { id: session.id, status: 'ACTIVE', exitRequestedAt: { not: null } },
      data: { exitRequestedAt: null },
    });
    if (count === 1) {
      await auditRepository.record({
        action: AUDIT_ACTIONS.exitRequestCancelled,
        actorId: context.actor?.id ?? null,
        entityType: AUDIT_ENTITY_TYPES.parkingSession,
        entityId: session.sessionNumber,
        metadata: channelMetadata(context),
        request: context.request,
      });
    }
    return toState(await load(sessionId));
  },
};
