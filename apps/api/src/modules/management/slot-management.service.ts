import {
  slotCodeMatchesVehicleType,
  type CreateSlotInput,
  type ManagedBlock,
  type ManagedLayout,
  type ManagedSlot,
  type ManagedZone,
  type SlotCounts,
  type SlotDeletionResult,
  type UpdateSlotRequest,
} from '@cpvts/shared';

import { isUniqueViolation } from '../../db/errors.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { campusHour } from '../../lib/campus-time.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { OperationContext } from '../parking/operation-context.js';
import { currentDuration, toBlockSummary } from '../parking/parking.mappers.js';
import { slotHoldRepository } from '../parking/slot-hold.repository.js';
import { managementErrors } from './management.errors.js';

const SLOT_INCLUDE = {
  sessions: { where: { status: 'ACTIVE' }, include: { vehicle: true }, take: 1 },
  _count: { select: { sessions: true } },
} as const satisfies Prisma.ParkingSlotInclude;

type SlotRow = Prisma.ParkingSlotGetPayload<{ include: typeof SLOT_INCLUDE }>;

/** Slots that can be edited, disabled or archived: idle ones. */
const IDLE_STATUSES = ['AVAILABLE', 'BLOCKED'] as const;

const toManagedSlot = (slot: SlotRow, hour: number): ManagedSlot => {
  const session = slot.sessions[0];
  return {
    code: slot.code,
    status: slot.status,
    priority: slot.priority,
    blockedReason: slot.status === 'BLOCKED' ? slot.blockedReason : null,
    isEnabled: slot.isEnabled,
    archivedAt: slot.archivedAt?.toISOString() ?? null,
    sortOrder: slot.sortOrder,
    holdExpiresAt: slot.status === 'HELD' ? (slot.holdExpiresAt?.toISOString() ?? null) : null,
    hasHistory: slot._count.sessions > 0,
    occupant: session
      ? {
          sessionNumber: session.sessionNumber,
          vehicleNumber: session.vehicle.vehicleNumber,
          vehicleType: session.vehicleType,
          ownerCategory: session.ownerCategory,
          entryHour: session.entryHour,
          currentDurationHours: currentDuration(session.entryHour, hour),
        }
      : null,
  };
};

const countsOf = (slots: ManagedSlot[]): SlotCounts => {
  const counts: SlotCounts = {
    total: 0,
    available: 0,
    occupied: 0,
    blocked: 0,
    held: 0,
    reserved: 0,
  };
  for (const slot of slots) {
    if (!slot.isEnabled || slot.archivedAt) continue;
    counts.total += 1;
    if (slot.status === 'AVAILABLE') counts.available += 1;
    else if (slot.status === 'OCCUPIED') counts.occupied += 1;
    else if (slot.status === 'BLOCKED') counts.blocked += 1;
    else if (slot.status === 'RESERVED') counts.reserved = (counts.reserved ?? 0) + 1;
    else counts.held += 1;
  }
  return counts;
};

const blockInclude = (includeArchived: boolean) =>
  ({
    zones: {
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: {
        slots: {
          where: includeArchived ? {} : { archivedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
          include: SLOT_INCLUDE,
        },
      },
    },
  }) as const satisfies Prisma.ParkingBlockInclude;

type BlockRow = Prisma.ParkingBlockGetPayload<{ include: ReturnType<typeof blockInclude> }>;

const toManagedBlock = (block: BlockRow, hour: number): ManagedBlock => ({
  ...toBlockSummary(block),
  description: block.description,
  isActive: block.isActive,
  sortOrder: block.sortOrder,
  zones: block.zones.map((zone): ManagedZone => {
    const slots = zone.slots.map((slot) => toManagedSlot(slot, hour));
    return {
      code: zone.code,
      name: zone.name,
      vehicleType: zone.vehicleType,
      isActive: zone.isActive,
      sortOrder: zone.sortOrder,
      counts: countsOf(slots),
      disabledSlots: slots.filter((slot) => !slot.isEnabled && !slot.archivedAt).length,
      slots,
    };
  }),
});

export const loadManagedBlock = async (code: string): Promise<ManagedBlock> => {
  const block = await prisma.parkingBlock.findUnique({
    where: { code },
    include: blockInclude(false),
  });
  if (!block) throw managementErrors.blockNotFound();
  return toManagedBlock(block, campusHour());
};

const loadManagedSlot = async (code: string): Promise<ManagedSlot> => {
  const slot = await prisma.parkingSlot.findUnique({ where: { code }, include: SLOT_INCLUDE });
  if (!slot) throw managementErrors.slotNotFound();
  return toManagedSlot(slot, campusHour());
};

const audit = (
  context: OperationContext,
  action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
  entityId: string,
  metadata: Prisma.InputJsonObject,
  tx: Prisma.TransactionClient,
  entityType: (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES] = AUDIT_ENTITY_TYPES.parkingSlot,
) =>
  auditRepository.record(
    { action, actorId: context.actor.id, entityType, entityId, metadata, request: context.request },
    tx,
  );

/** Why a conditional update touched no row: missing, archived, or in the wrong state. */
const explainMiss = async (
  tx: Prisma.TransactionClient,
  code: string,
  wrongState: () => Error,
): Promise<never> => {
  const slot = await tx.parkingSlot.findUnique({ where: { code }, select: { archivedAt: true } });
  if (!slot) throw managementErrors.slotNotFound();
  if (slot.archivedAt) throw managementErrors.slotArchived();
  throw wrongState();
};

/**
 * Administrator slot inventory (Master Blueprint §23). Every state change is an
 * atomic conditional update, so no operation can disturb a parked vehicle or a
 * slot held for a user, and every change is audited.
 *
 * Capacity rules: only enabled, non-archived slots count and are allocated. A
 * new AVAILABLE slot is allocated by the existing engine immediately — the
 * engine reads the slot table, not a list in code. A slot with parking history
 * is never removed (archived instead), so history, receipts and reports stay
 * intact.
 */
export const slotManagementService = {
  async getLayout({ includeArchived = false } = {}): Promise<ManagedLayout> {
    await slotHoldRepository.releaseExpired();
    const blocks = await prisma.parkingBlock.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: blockInclude(includeArchived),
    });
    const hour = campusHour();
    return { blocks: blocks.map((block) => toManagedBlock(block, hour)) };
  },

  async create(input: CreateSlotInput, context: OperationContext): Promise<ManagedSlot> {
    try {
      await withTransaction(async (tx) => {
        const zone = await tx.parkingZone.findUnique({
          where: { code: input.zoneCode },
          include: { block: { select: { isActive: true } } },
        });
        if (!zone) throw managementErrors.zoneNotFound();
        if (!zone.isActive || !zone.block.isActive) throw managementErrors.zoneInactive();
        if (zone.vehicleType !== input.vehicleType) throw managementErrors.zoneTypeMismatch();

        const taken = await tx.parkingSlot.findUnique({
          where: { code: input.code },
          select: { archivedAt: true },
        });
        if (taken) throw managementErrors.slotCodeTaken(Boolean(taken.archivedAt));

        const last = await tx.parkingSlot.aggregate({
          where: { zoneId: zone.id },
          _max: { sortOrder: true },
        });
        const blocked = input.status === 'BLOCKED';
        await tx.parkingSlot.create({
          data: {
            zoneId: zone.id,
            code: input.code,
            status: input.status,
            priority: input.priority,
            sortOrder: input.sortOrder ?? (last._max.sortOrder ?? -1) + 1,
            blockedReason: blocked ? (input.blockedReason ?? null) : null,
          },
        });
        await audit(
          context,
          AUDIT_ACTIONS.slotCreated,
          input.code,
          {
            zone: zone.code,
            vehicleType: zone.vehicleType,
            priority: input.priority,
            status: input.status,
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'parking_slots_code_key')) {
        throw managementErrors.slotCodeTaken();
      }
      throw error;
    }
    return loadManagedSlot(input.code);
  },

  /**
   * Edits priority and layout order at any time (neither disturbs a parked
   * vehicle). Renaming or moving a slot needs an idle slot without history;
   * the blocked reason can change only while the slot is blocked.
   */
  async update(
    code: string,
    patch: UpdateSlotRequest,
    context: OperationContext,
  ): Promise<ManagedSlot> {
    let finalCode = code;
    try {
      await withTransaction(async (tx) => {
        const slot = await tx.parkingSlot.findUnique({
          where: { code },
          include: {
            zone: { include: { block: { select: { isActive: true } } } },
            _count: { select: { sessions: true } },
          },
        });
        if (!slot) throw managementErrors.slotNotFound();
        if (slot.archivedAt) throw managementErrors.slotArchived();

        const data: Prisma.ParkingSlotUncheckedUpdateInput = {};
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const change = (field: string, from: unknown, to: unknown) => {
          changes[field] = { from, to };
        };

        const newCode = patch.code ?? slot.code;
        const movesOrRenames =
          newCode !== slot.code ||
          (patch.zoneCode !== undefined && patch.zoneCode !== slot.zone.code);
        if (movesOrRenames) {
          if (!IDLE_STATUSES.includes(slot.status as (typeof IDLE_STATUSES)[number])) {
            throw managementErrors.slotInUse();
          }
          if (slot._count.sessions > 0) throw managementErrors.slotHasHistory();

          const zone =
            patch.zoneCode !== undefined && patch.zoneCode !== slot.zone.code
              ? await tx.parkingZone.findUnique({
                  where: { code: patch.zoneCode },
                  include: { block: { select: { isActive: true } } },
                })
              : slot.zone;
          if (!zone) throw managementErrors.zoneNotFound();
          if (!zone.isActive || !zone.block.isActive) throw managementErrors.zoneInactive();
          if (!slotCodeMatchesVehicleType(newCode, zone.vehicleType)) {
            throw managementErrors.slotCodeMismatch();
          }
          if (newCode !== slot.code) {
            const taken = await tx.parkingSlot.findUnique({
              where: { code: newCode },
              select: { archivedAt: true },
            });
            if (taken) throw managementErrors.slotCodeTaken(Boolean(taken.archivedAt));
            data.code = newCode;
            change('code', slot.code, newCode);
          }
          if (zone.id !== slot.zoneId) {
            data.zoneId = zone.id;
            change('zone', slot.zone.code, zone.code);
          }
        }

        if (patch.priority !== undefined && patch.priority !== slot.priority) {
          data.priority = patch.priority;
          change('priority', slot.priority, patch.priority);
        }
        if (patch.sortOrder !== undefined && patch.sortOrder !== slot.sortOrder) {
          data.sortOrder = patch.sortOrder;
          change('sortOrder', slot.sortOrder, patch.sortOrder);
        }
        if (patch.blockedReason !== undefined && patch.blockedReason !== slot.blockedReason) {
          if (slot.status !== 'BLOCKED') throw managementErrors.slotNotBlocked();
          data.blockedReason = patch.blockedReason;
          change('blockedReason', slot.blockedReason, patch.blockedReason);
        }

        if (Object.keys(data).length === 0) return;
        // Guard against a vehicle or hold arriving since the read above.
        const updated = await tx.parkingSlot.updateMany({
          where: {
            id: slot.id,
            archivedAt: null,
            ...(movesOrRenames ? { status: { in: [...IDLE_STATUSES] } } : {}),
          },
          data,
        });
        if (updated.count !== 1) throw managementErrors.slotInUse();
        finalCode = newCode;
        await audit(
          context,
          AUDIT_ACTIONS.slotUpdated,
          newCode,
          {
            changes: changes as Prisma.InputJsonObject,
            ...(newCode !== code ? { previousCode: code } : {}),
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'parking_slots_code_key')) {
        throw managementErrors.slotCodeTaken();
      }
      throw error;
    }
    return loadManagedSlot(finalCode);
  },

  async block(code: string, reason: string, context: OperationContext): Promise<ManagedSlot> {
    await withTransaction(async (tx) => {
      const { count } = await tx.parkingSlot.updateMany({
        where: { code, status: 'AVAILABLE', archivedAt: null },
        data: { status: 'BLOCKED', blockedReason: reason },
      });
      if (count !== 1) await explainMiss(tx, code, managementErrors.slotNotAvailable);
      await audit(context, AUDIT_ACTIONS.slotBlocked, code, { reason }, tx);
    });
    return loadManagedSlot(code);
  },

  async unblock(code: string, context: OperationContext): Promise<ManagedSlot> {
    await withTransaction(async (tx) => {
      const { count } = await tx.parkingSlot.updateMany({
        where: { code, status: 'BLOCKED', archivedAt: null },
        data: { status: 'AVAILABLE', blockedReason: null },
      });
      if (count !== 1) await explainMiss(tx, code, managementErrors.slotNotBlocked);
      await audit(context, AUDIT_ACTIONS.slotUnblocked, code, {}, tx);
    });
    return loadManagedSlot(code);
  },

  async setPriority(
    code: string,
    priority: number,
    context: OperationContext,
  ): Promise<ManagedSlot> {
    await withTransaction(async (tx) => {
      const slot = await tx.parkingSlot.findUnique({ where: { code } });
      if (!slot) throw managementErrors.slotNotFound();
      if (slot.archivedAt) throw managementErrors.slotArchived();
      await tx.parkingSlot.update({ where: { code }, data: { priority } });
      await audit(
        context,
        AUDIT_ACTIONS.slotPriorityChanged,
        code,
        { from: slot.priority, to: priority },
        tx,
      );
    });
    return loadManagedSlot(code);
  },

  /** Takes an idle slot out of service: never allocated, not counted as capacity. */
  async disable(code: string, context: OperationContext): Promise<ManagedSlot> {
    await withTransaction(async (tx) => {
      const { count } = await tx.parkingSlot.updateMany({
        where: { code, archivedAt: null, isEnabled: true, status: { in: [...IDLE_STATUSES] } },
        data: { isEnabled: false },
      });
      if (count === 1) {
        await audit(context, AUDIT_ACTIONS.slotDisabled, code, {}, tx);
        return;
      }
      const slot = await tx.parkingSlot.findUnique({ where: { code } });
      if (!slot) throw managementErrors.slotNotFound();
      if (slot.archivedAt) throw managementErrors.slotArchived();
      if (!slot.isEnabled) return; // already disabled: nothing to do
      throw managementErrors.slotInUse();
    });
    return loadManagedSlot(code);
  },

  async enable(code: string, context: OperationContext): Promise<ManagedSlot> {
    await withTransaction(async (tx) => {
      const { count } = await tx.parkingSlot.updateMany({
        where: { code, archivedAt: null, isEnabled: false },
        data: { isEnabled: true },
      });
      if (count === 1) {
        await audit(context, AUDIT_ACTIONS.slotEnabled, code, {}, tx);
        return;
      }
      const slot = await tx.parkingSlot.findUnique({ where: { code } });
      if (!slot) throw managementErrors.slotNotFound();
      if (slot.archivedAt) throw managementErrors.slotArchived();
      // already enabled: nothing to do
    });
    return loadManagedSlot(code);
  },

  /**
   * Safe delete. An idle slot that nothing ever referenced is removed; one with
   * parking history is archived instead (`forceArchive` archives either way).
   * Occupied or held slots are refused. History, receipts and reports keep
   * pointing at archived slots.
   */
  async remove(
    code: string,
    context: OperationContext,
    { forceArchive = false } = {},
  ): Promise<SlotDeletionResult> {
    return withTransaction(async (tx) => {
      const slot = await tx.parkingSlot.findUnique({
        where: { code },
        include: { _count: { select: { sessions: true } } },
      });
      if (!slot) throw managementErrors.slotNotFound();
      if (!IDLE_STATUSES.includes(slot.status as (typeof IDLE_STATUSES)[number])) {
        throw managementErrors.slotInUse();
      }
      const hasHistory = slot._count.sessions > 0;

      if (!hasHistory && !forceArchive) {
        // Conditional on idleness and no sessions; Park Now offers go with the slot.
        const { count } = await tx.parkingSlot.deleteMany({
          where: { id: slot.id, status: { in: [...IDLE_STATUSES] }, sessions: { none: {} } },
        });
        if (count !== 1) throw managementErrors.slotInUse();
        await audit(context, AUDIT_ACTIONS.slotDeleted, code, {}, tx);
        return { outcome: 'DELETED', code };
      }

      if (slot.archivedAt) throw managementErrors.slotArchived();
      const { count } = await tx.parkingSlot.updateMany({
        where: { id: slot.id, archivedAt: null, status: { in: [...IDLE_STATUSES] } },
        data: { archivedAt: new Date() },
      });
      if (count !== 1) throw managementErrors.slotInUse();
      await audit(context, AUDIT_ACTIONS.slotArchived, code, { hasHistory }, tx);
      return { outcome: 'ARCHIVED', code };
    });
  },

  async restore(code: string, context: OperationContext): Promise<ManagedSlot> {
    await withTransaction(async (tx) => {
      const { count } = await tx.parkingSlot.updateMany({
        where: { code, archivedAt: { not: null } },
        data: { archivedAt: null },
      });
      if (count !== 1) {
        const exists = await tx.parkingSlot.count({ where: { code } });
        throw exists ? managementErrors.slotNotArchived() : managementErrors.slotNotFound();
      }
      await audit(context, AUDIT_ACTIONS.slotRestored, code, {}, tx);
    });
    return loadManagedSlot(code);
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
        code,
        { latitude: location.latitude, longitude: location.longitude },
        tx,
        AUDIT_ENTITY_TYPES.parkingBlock,
      );
      return toBlockSummary(updated);
    });
  },
};
