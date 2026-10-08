import type { ManagedLayout, ManagedSlot } from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { OperationContext } from '../parking/operation-context.js';
import { toBlockSummary } from '../parking/parking.mappers.js';
import { slotHoldRepository } from '../parking/slot-hold.repository.js';
import { managementErrors } from './management.errors.js';

const toManagedSlot = (slot: {
  code: string;
  status: ManagedSlot['status'];
  priority: number;
  blockedReason: string | null;
}): ManagedSlot => ({
  code: slot.code,
  status: slot.status,
  priority: slot.priority,
  blockedReason: slot.status === 'BLOCKED' ? slot.blockedReason : null,
});

const audit = (
  context: OperationContext,
  action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
  entityType: (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES],
  entityId: string,
  metadata: Prisma.InputJsonObject,
  tx: Prisma.TransactionClient,
) =>
  auditRepository.record(
    { action, actorId: context.actor.id, entityType, entityId, metadata, request: context.request },
    tx,
  );

/**
 * Administrator slot management (Master Blueprint §23). Only AVAILABLE slots
 * can be blocked and only BLOCKED slots unblocked; both are atomic
 * conditional updates, so they can never disturb a parked vehicle.
 */
export const slotManagementService = {
  async getLayout(): Promise<ManagedLayout> {
    await slotHoldRepository.releaseExpired();
    const blocks = await prisma.parkingBlock.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: {
        zones: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
          include: { slots: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
        },
      },
    });
    return {
      blocks: blocks.map((block) => ({
        ...toBlockSummary(block),
        description: block.description,
        zones: block.zones.map((zone) => ({
          code: zone.code,
          name: zone.name,
          vehicleType: zone.vehicleType,
          slots: zone.slots.map(toManagedSlot),
        })),
      })),
    };
  },

  async block(code: string, reason: string, context: OperationContext): Promise<ManagedSlot> {
    return withTransaction(async (tx) => {
      const { count } = await tx.parkingSlot.updateMany({
        where: { code, status: 'AVAILABLE' },
        data: { status: 'BLOCKED', blockedReason: reason },
      });
      if (count !== 1) {
        const exists = await tx.parkingSlot.count({ where: { code } });
        throw exists ? managementErrors.slotNotAvailable() : managementErrors.slotNotFound();
      }
      await audit(
        context,
        AUDIT_ACTIONS.slotBlocked,
        AUDIT_ENTITY_TYPES.parkingSlot,
        code,
        { reason },
        tx,
      );
      return toManagedSlot(await tx.parkingSlot.findUniqueOrThrow({ where: { code } }));
    });
  },

  async unblock(code: string, context: OperationContext): Promise<ManagedSlot> {
    return withTransaction(async (tx) => {
      const { count } = await tx.parkingSlot.updateMany({
        where: { code, status: 'BLOCKED' },
        data: { status: 'AVAILABLE', blockedReason: null },
      });
      if (count !== 1) {
        const exists = await tx.parkingSlot.count({ where: { code } });
        throw exists ? managementErrors.slotNotBlocked() : managementErrors.slotNotFound();
      }
      await audit(
        context,
        AUDIT_ACTIONS.slotUnblocked,
        AUDIT_ENTITY_TYPES.parkingSlot,
        code,
        {},
        tx,
      );
      return toManagedSlot(await tx.parkingSlot.findUniqueOrThrow({ where: { code } }));
    });
  },

  async setPriority(
    code: string,
    priority: number,
    context: OperationContext,
  ): Promise<ManagedSlot> {
    return withTransaction(async (tx) => {
      const slot = await tx.parkingSlot.findUnique({ where: { code } });
      if (!slot) throw managementErrors.slotNotFound();
      const updated = await tx.parkingSlot.update({ where: { code }, data: { priority } });
      await audit(
        context,
        AUDIT_ACTIONS.slotPriorityChanged,
        AUDIT_ENTITY_TYPES.parkingSlot,
        code,
        { from: slot.priority, to: priority },
        tx,
      );
      return toManagedSlot(updated);
    });
  },

  /** Sets (or clears) a block's real-world coordinates. */
  async setBlockLocation(
    code: string,
    location: { latitude: number | null; longitude: number | null },
    context: OperationContext,
  ) {
    return withTransaction(async (tx) => {
      const block = await tx.parkingBlock.findUnique({ where: { code } });
      if (!block) throw managementErrors.blockNotFound();
      const updated = await tx.parkingBlock.update({
        where: { code },
        data: { latitude: location.latitude, longitude: location.longitude },
      });
      await audit(
        context,
        AUDIT_ACTIONS.blockLocationUpdated,
        AUDIT_ENTITY_TYPES.parkingBlock,
        code,
        { latitude: location.latitude, longitude: location.longitude },
        tx,
      );
      return toBlockSummary(updated);
    });
  },
};
