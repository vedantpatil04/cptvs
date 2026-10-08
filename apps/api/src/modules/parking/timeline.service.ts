import type {
  AuditAction,
  PaymentMethod,
  SessionTimelineResponse,
  TimelineDetails,
} from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { parkingErrors } from './parking.errors.js';

type Metadata = Record<string, unknown>;

const num = (value: unknown) => (typeof value === 'number' ? value : undefined);
const str = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** Picks the user-relevant details for each action from the audit metadata. */
const detailsFor = (action: string, entityId: string | null, meta: Metadata): TimelineDetails => {
  const clean = (details: TimelineDetails) =>
    Object.fromEntries(
      Object.entries(details).filter(([, value]) => value !== undefined),
    ) as TimelineDetails;
  switch (action) {
    case AUDIT_ACTIONS.vehicleCheckedIn:
      return clean({ vehicleNumber: str(meta.vehicleNumber), entryHour: num(meta.entryHour) });
    case AUDIT_ACTIONS.slotAssigned:
      return clean({ slotCode: entityId ?? undefined, score: num(meta.score) });
    case AUDIT_ACTIONS.checkoutInitiated:
      return clean({
        exitHour: num(meta.exitHour),
        durationHours: num(meta.durationHours),
        amountPaise: num(meta.totalPaise),
      });
    case AUDIT_ACTIONS.paymentInitiated:
    case AUDIT_ACTIONS.paymentSucceeded:
      return clean({
        transactionId: entityId ?? undefined,
        method: str(meta.method) as PaymentMethod | undefined,
        amountPaise: num(meta.amountPaise),
      });
    case AUDIT_ACTIONS.paymentFailed:
    case AUDIT_ACTIONS.paymentCancelled:
      return clean({ transactionId: entityId ?? undefined, reason: str(meta.reason) });
    case AUDIT_ACTIONS.transactionFinalized:
      return clean({
        exitHour: num(meta.exitHour),
        durationHours: num(meta.durationHours),
        amountPaise: num(meta.totalPaise),
        transactionId: str(meta.transactionId),
      });
    case AUDIT_ACTIONS.receiptGenerated:
      return clean({ receiptNumber: entityId ?? undefined, amountPaise: num(meta.amountPaise) });
    case AUDIT_ACTIONS.slotReleased:
      return clean({ slotCode: entityId ?? undefined });
    case AUDIT_ACTIONS.integrityRejected:
      return clean({ reason: str(meta.code) });
    default:
      return {};
  }
};

/**
 * Session timeline / audit replay (Master Blueprint §19), rebuilt from the
 * audit log: every event recorded for the session itself or referencing it.
 */
export const timelineService = {
  async forSession(sessionNumber: string): Promise<SessionTimelineResponse> {
    const exists = await prisma.parkingSession.count({ where: { sessionNumber } });
    if (!exists) throw parkingErrors.sessionNotFound();

    const entries = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: AUDIT_ENTITY_TYPES.parkingSession, entityId: sessionNumber },
          { metadata: { path: ['sessionNumber'], equals: sessionNumber } },
        ],
      },
      include: { actor: { select: { fullName: true, role: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return {
      sessionNumber,
      events: entries.map((entry) => ({
        at: entry.createdAt.toISOString(),
        action: entry.action as AuditAction,
        actor: entry.actor,
        details: detailsFor(
          entry.action,
          entry.entityId,
          (entry.metadata as Metadata | null) ?? {},
        ),
      })),
    };
  },
};
