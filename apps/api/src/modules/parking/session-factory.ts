import type { OwnerCategory, VehicleType } from '@cpvts/shared';

import type { Prisma } from '../../generated/prisma/client.js';
import { newOpaqueReference, newSessionNumber } from '../../lib/identifiers.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { RequestMeta } from '../auth/auth.types.js';
import { notificationService } from '../notifications/notification.service.js';
import { SESSION_INCLUDE, type SessionWithRelations } from './parking.repository.js';

/** How the vehicle came in: a Security Staff member at the desk, or the owner with Park Now. */
export type EntryChannel = 'SECURITY' | 'SELF_SERVICE';

/** Generates a session number not yet in use (collisions are astronomically unlikely). */
export const uniqueSessionNumber = async (
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = newSessionNumber();
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('Could not generate a unique session number');
};

export interface NewSessionInput {
  vehicle: { id: string; vehicleNumber: string; ownerUserId: string | null };
  vehicleType: VehicleType;
  slot: { id: string; code: string; blockName: string };
  ownerCategory: OwnerCategory;
  /** `ACCOUNT` when the category comes from the vehicle owner's verified account. */
  categorySource: 'ACCOUNT' | 'OPERATOR';
  entryHour: number;
  /** The Security Staff member at the desk, or the owner confirming Park Now. */
  checkedInById: string;
  channel: EntryChannel;
  /** The allocation engine's scoring of the chosen slot, recorded for the audit trail. */
  allocation: {
    score: number;
    priority: number;
    usesToday: number;
    layoutPosition: number;
    candidates: number;
  };
  /** The Park Now offer this session confirms, if any. */
  offerId?: string;
  /** Reuse this opaque reference as the session QR (a visitor reservation keeps its QR). */
  entryReference?: string;
  request: RequestMeta;
}

/**
 * The single place an ACTIVE parking session is created. The Security desk check-in and
 * the Student / Campus Staff Park Now confirmation both end here, so a session — its
 * number, its session QR reference, its owner snapshot, its audit trail and the owner's
 * notification — is identical however the vehicle arrived. The slot must already have
 * been moved HELD → OCCUPIED in the same transaction.
 */
export const createActiveSession = async (
  tx: Prisma.TransactionClient,
  input: NewSessionInput,
): Promise<SessionWithRelations> => {
  const sessionNumber = await uniqueSessionNumber(
    async (value) => (await tx.parkingSession.count({ where: { sessionNumber: value } })) > 0,
  );
  const session = await tx.parkingSession.create({
    data: {
      sessionNumber,
      entryReference: input.entryReference ?? newOpaqueReference(),
      vehicleId: input.vehicle.id,
      slotId: input.slot.id,
      vehicleType: input.vehicleType,
      ownerCategory: input.ownerCategory,
      entryHour: input.entryHour,
      entryAt: new Date(),
      checkedInById: input.checkedInById,
      // The account that owns the vehicle right now keeps this session in its history for good.
      ownerUserId: input.vehicle.ownerUserId,
    },
    include: SESSION_INCLUDE,
  });

  const via = input.channel === 'SELF_SERVICE' ? { via: 'SELF_SERVICE' as const } : {};
  await auditRepository.record(
    {
      action: AUDIT_ACTIONS.vehicleCheckedIn,
      actorId: input.checkedInById,
      entityType: AUDIT_ENTITY_TYPES.parkingSession,
      entityId: session.sessionNumber,
      metadata: {
        vehicleNumber: input.vehicle.vehicleNumber,
        vehicleType: input.vehicleType,
        ownerCategory: input.ownerCategory,
        categorySource: input.categorySource,
        entryHour: input.entryHour,
        ...(input.offerId ? { offerId: input.offerId } : {}),
        ...via,
      },
      request: input.request,
    },
    tx,
  );
  await auditRepository.record(
    {
      action: AUDIT_ACTIONS.slotAssigned,
      actorId: input.checkedInById,
      entityType: AUDIT_ENTITY_TYPES.parkingSlot,
      entityId: input.slot.code,
      metadata: {
        sessionNumber: session.sessionNumber,
        score: input.allocation.score,
        priority: input.allocation.priority,
        usesToday: input.allocation.usesToday,
        layoutPosition: input.allocation.layoutPosition,
        candidates: input.allocation.candidates,
        ...via,
      },
      request: input.request,
    },
    tx,
  );

  // A vehicle registered to a verified Student / Campus Staff account: tell its owner.
  if (input.vehicle.ownerUserId && input.categorySource === 'ACCOUNT') {
    await notificationService.notify(
      input.vehicle.ownerUserId,
      'PARKING_STARTED',
      {
        sessionNumber: session.sessionNumber,
        slotCode: input.slot.code,
        blockName: input.slot.blockName,
        vehicleNumber: input.vehicle.vehicleNumber,
      },
      tx,
    );
  }
  return session;
};
