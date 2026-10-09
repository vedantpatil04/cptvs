import type { ScanCheckoutResponse } from '@cpvts/shared';

import { AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRejection, type ActorContext } from './operation-context.js';
import { parkingErrors } from './parking.errors.js';
import { toSessionView } from './parking.mappers.js';
import { parkingRepository, type SessionWithRelations } from './parking.repository.js';
import { exitTimeService } from './exit-time.service.js';
import { liveContext } from './tracking.service.js';

/** How the gate identified the session before verification. */
export type VerifiedSource = 'ENTRY_QR' | 'EXIT_CODE';

/**
 * The checks every gate identification (session QR, exit code) must pass before the operator
 * sees the session: it is ACTIVE, and the vehicle's, the slot's and the session's records agree
 * with the slot OCCUPIED. Nothing here changes state — completing the checkout is a separate,
 * authorized step. Returns the authoritative session for the operator to confirm.
 *
 * This is the exit workflow only (the entry-side arrival check uses its own route), so it is
 * where the server captures the exit instant and the timer stops. The capture is idempotent:
 * scanning again returns the same instant.
 */
export const verifyActiveSession = async (
  session: SessionWithRelations,
  source: VerifiedSource,
  context: ActorContext,
): Promise<ScanCheckoutResponse> => {
  const subject = {
    entityType: AUDIT_ENTITY_TYPES.parkingSession,
    entityId: session.sessionNumber,
    metadata: { source },
  } as const;

  if (session.status !== 'ACTIVE') {
    throw await auditRejection(parkingErrors.sessionNotActive(), context, subject);
  }

  const [vehicleSession, slotSession] = await Promise.all([
    parkingRepository.findActiveSessionByVehicleNumber(session.vehicle.vehicleNumber),
    parkingRepository.findActiveSessionBySlotId(session.slotId),
  ]);
  if (
    vehicleSession?.id !== session.id ||
    slotSession?.id !== session.id ||
    session.slot.status !== 'OCCUPIED'
  ) {
    throw await auditRejection(parkingErrors.sessionInconsistent(), context, subject);
  }

  const exitAt = await exitTimeService.capture(session, source, context);

  return {
    matchedBy: source,
    session: toSessionView({ ...session, exitCapturedAt: exitAt }, await liveContext()),
    exitRequested: session.exitRequestedAt !== null,
    exitAt: exitAt.toISOString(),
    checks: {
      reference: true,
      sessionActive: true,
      vehicleMatchesSession: true,
      slotMatchesSession: true,
    },
  };
};
