import type { AdjustSessionTimeRequest } from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import { campusDateString, campusHour } from '../../lib/campus-time.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import {
  auditRejection,
  channelMetadata,
  type ActorContext,
  type OperationContext,
} from './operation-context.js';
import { parkingErrors } from './parking.errors.js';
import { parkingRepository } from './parking.repository.js';

/**
 * The exit time of a parking session, owned by the server.
 *
 *  - `capture` stops the timer: the first time Security identifies the session at the exit gate
 *    (scanning its QR or typing its exit code) the server records that instant. It is
 *    idempotent — a repeated scan, a page refresh or a second device gets the same instant and
 *    never restarts the timer. Opening the QR screen or verifying an arrival does not call it.
 *  - `adjust` is Security's audited correction of the recorded entry and exit times before the
 *    final checkout. The fee is then priced again from the corrected times by the fee engine;
 *    nothing here accepts a fee, and a completed session is never reopened.
 */
export const exitTimeService = {
  /** Records the exit instant on first call and returns it; later calls return the same one. */
  async capture(
    session: { id: string; sessionNumber: string; exitCapturedAt: Date | null },
    source: 'ENTRY_QR' | 'EXIT_CODE' | 'CHECKOUT',
    context: ActorContext,
  ): Promise<Date> {
    if (session.exitCapturedAt) return session.exitCapturedAt;

    const now = new Date();
    // Compare-and-set: of two concurrent first scans exactly one records the instant.
    const claimed = await prisma.parkingSession.updateMany({
      where: { id: session.id, status: 'ACTIVE', exitCapturedAt: null },
      data: { exitCapturedAt: now },
    });
    if (claimed.count === 1) {
      await auditRepository.record({
        action: AUDIT_ACTIONS.exitTimeCaptured,
        actorId: context.actor?.id ?? null,
        entityType: AUDIT_ENTITY_TYPES.parkingSession,
        entityId: session.sessionNumber,
        metadata: { source, exitAt: now.toISOString(), ...channelMetadata(context) },
        request: context.request,
      });
      return now;
    }
    const current = await prisma.parkingSession.findUnique({
      where: { id: session.id },
      select: { exitCapturedAt: true },
    });
    return current?.exitCapturedAt ?? now;
  },

  /**
   * Corrects the entry and exit time of an ACTIVE session. Both are instants on the same campus
   * day with entry ≤ exit ≤ now (the whole-hour fee model cannot price a stay across midnight).
   * Any payment attempt made for the old times is cancelled so the next one is priced afresh.
   */
  async adjust(
    sessionNumber: string,
    input: AdjustSessionTimeRequest,
    context: OperationContext,
  ): Promise<void> {
    const session = await parkingRepository.findSessionByNumber(sessionNumber);
    if (!session) throw parkingErrors.sessionNotFound();

    const subject = {
      entityType: AUDIT_ENTITY_TYPES.parkingSession,
      entityId: session.sessionNumber,
    } as const;
    const refuse = async (error: ReturnType<typeof parkingErrors.timeRangeInvalid>) =>
      auditRejection(error, context, {
        ...subject,
        metadata: { reason: error.code, entryAt: input.entryAt, exitAt: input.exitAt },
      });

    // A finished session is never silently reopened or repriced.
    if (session.status !== 'ACTIVE') {
      throw await auditRejection(parkingErrors.sessionTimeLocked(), context, {
        ...subject,
        metadata: { reason: 'SESSION_COMPLETED' },
      });
    }

    const entryAt = new Date(input.entryAt);
    const exitAt = new Date(input.exitAt);
    const now = new Date();
    if (entryAt.getTime() > exitAt.getTime()) {
      throw await refuse(parkingErrors.timeRangeInvalid('ENTRY_AFTER_EXIT'));
    }
    if (exitAt.getTime() > now.getTime()) {
      throw await refuse(parkingErrors.timeRangeInvalid('EXIT_IN_FUTURE'));
    }
    if (campusDateString(entryAt) !== campusDateString(exitAt)) {
      throw await refuse(parkingErrors.timeRangeInvalid('TIME_RANGE_OVERNIGHT'));
    }
    if (
      entryAt.getTime() === session.entryAt.getTime() &&
      exitAt.getTime() === session.exitCapturedAt?.getTime()
    ) {
      throw await refuse(parkingErrors.timeRangeInvalid('TIME_UNCHANGED'));
    }

    const entryHour = campusHour(entryAt);
    await withTransaction(async (tx) => {
      if (await tx.payment.count({ where: { sessionId: session.id, status: 'PROCESSING' } })) {
        throw parkingErrors.paymentInProgress();
      }
      // A payment prepared for the old times no longer matches the amount due.
      await tx.payment.updateMany({
        where: { sessionId: session.id, status: 'PENDING' },
        data: { status: 'CANCELLED', failureReason: 'SUPERSEDED' },
      });
      const updated = await tx.parkingSession.updateMany({
        where: { id: session.id, status: 'ACTIVE' },
        data: { entryAt, entryHour, exitCapturedAt: exitAt, timeAdjustedAt: now },
      });
      if (updated.count !== 1) throw parkingErrors.sessionNotActive();
      await auditRepository.record(
        {
          action: AUDIT_ACTIONS.sessionTimeAdjusted,
          actorId: context.actor.id,
          ...subject,
          metadata: {
            reason: input.reason,
            original: {
              entryAt: session.entryAt.toISOString(),
              entryHour: session.entryHour,
              exitAt: session.exitCapturedAt?.toISOString() ?? null,
            },
            corrected: {
              entryAt: entryAt.toISOString(),
              entryHour,
              exitAt: exitAt.toISOString(),
              exitHour: campusHour(exitAt),
            },
            adjustedAt: now.toISOString(),
            ...channelMetadata(context),
          },
          request: context.request,
        },
        tx,
      );
    });
  },
};
