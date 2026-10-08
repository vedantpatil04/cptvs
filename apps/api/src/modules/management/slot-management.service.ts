import {
  SLOT_CODE_PREFIX,
  type createSlotRequestSchema,
  type DeleteSlotResponse,
  type ManagedBlock,
  type ManagedLayout,
  type ManagedSlot,
  type ManagedZone,
  type NextSlotCodeResponse,
  type updateBlockRequestSchema,
  type updateSlotRequestSchema,
  type updateZoneRequestSchema,
} from '@cpvts/shared';
import type { z } from 'zod';

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

type CreateSlotInput = z.output<typeof createSlotRequestSchema>;
type UpdateSlotInput = z.output<typeof updateSlotRequestSchema>;
type UpdateBlockInput = z.output<typeof updateBlockRequestSchema>;
type UpdateZoneInput = z.output<typeof updateZoneRequestSchema>;

/** What the administrator sees of a slot: its state, the parked vehicle and whether it has history. */
const SLOT_INCLUDE = {
  sessions: { where: { status: 'ACTIVE' }, take: 1, include: { vehicle: true } },
  _count: { select: { sessions: true } },
} as const satisfies Prisma.ParkingSlotInclude;

type SlotRow = Prisma.ParkingSlotGetPayload<{ include: typeof SLOT_INCLUDE }>;

/** Archived slots are hidden everywhere; they only keep history intact. */
const VISIBLE = { archivedAt: null } as const;

const toManagedSlot = (slot: SlotRow, hour: number): ManagedSlot => {
  const session = slot.sessions[0];
  return {
    code: slot.code,
    status: slot.status,
    priority: slot.priority,
    blockedReason: slot.status === 'BLOCKED' ? slot.blockedReason : null,
    label: slot.label,
    isActive: slot.isActive,
    sessionCount: slot._count.sessions,
    occupant: session
      ? {
          sessionNumber: session.sessionNumber,
          vehicleNumber: session.vehicle.vehicleNumber,
          vehicleType: session.vehicleType,
          ownerCategory: session.ownerCategory,
          entryHour: session.entryHour,
          entryAt: session.entryAt.toISOString(),
          currentDurationHours: currentDuration(session.entryHour, hour),
        }
      : null,
    createdAt: slot.createdAt.toISOString(),
    updatedAt: slot.updatedAt.toISOString(),
  };
};

const ZONE_INCLUDE = {
  slots: {
    where: VISIBLE,
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    include: SLOT_INCLUDE,
  },
} as const satisfies Prisma.ParkingZoneInclude;

type ZoneRow = Prisma.ParkingZoneGetPayload<{ include: typeof ZONE_INCLUDE }>;

const toManagedZone = (zone: ZoneRow, hour: number): ManagedZone => ({
  code: zone.code,
  name: zone.name,
  vehicleType: zone.vehicleType,
  isActive: zone.isActive,
  slots: zone.slots.map((slot) => toManagedSlot(slot, hour)),
});

const toManagedBlock = (
  block: Prisma.ParkingBlockGetPayload<{ include: { zones: { include: typeof ZONE_INCLUDE } } }>,
  hour: number,
): ManagedBlock => ({
  ...toBlockSummary(block),
  description: block.description,
  isActive: block.isActive,
  zones: block.zones.map((zone) => toManagedZone(zone, hour)),
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

const loadSlot = async (tx: Prisma.TransactionClient, code: string): Promise<ManagedSlot> =>
  toManagedSlot(
    await tx.parkingSlot.findFirstOrThrow({ where: { code, ...VISIBLE }, include: SLOT_INCLUDE }),
    campusHour(),
  );

/** Why a conditional slot update matched nothing: unknown, out of service, or in the wrong state. */
const explainRefusal = async (
  tx: Prisma.TransactionClient,
  code: string,
  inState: () => Error,
): Promise<Error> => {
  const slot = await tx.parkingSlot.findUnique({ where: { code } });
  if (!slot || slot.archivedAt) return managementErrors.slotNotFound();
  if (!slot.isActive) return managementErrors.slotDisabled();
  return inState();
};

/** True while the slot, or a session in it, is in use right now. */
const slotBusy = (slot: { status: string }, activeSessions: number): boolean =>
  slot.status === 'OCCUPIED' || slot.status === 'HELD' || activeSessions > 0;

/**
 * Administrator slot management (Master Blueprint §23). Every state change is
 * an atomic conditional update, so none of them can disturb a parked vehicle or
 * a slot an allocation is holding; history is never destroyed.
 */
export const slotManagementService = {
  /** Every block, zone and slot (disabled ones included) with the parked vehicle of occupied slots. */
  async getLayout(): Promise<ManagedLayout> {
    await slotHoldRepository.releaseExpired();
    const blocks = await prisma.parkingBlock.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: {
        zones: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], include: ZONE_INCLUDE },
      },
    });
    const hour = campusHour();
    return { blocks: blocks.map((block) => toManagedBlock(block, hour)) };
  },

  /**
   * Adds a slot to an existing zone. The zone fixes the vehicle type, the ID
   * must carry the matching letter and be unused, and the slot joins the
   * allocation pool immediately when it is created available.
   */
  async create(input: CreateSlotInput, context: OperationContext): Promise<ManagedSlot> {
    try {
      return await withTransaction(async (tx) => {
        const zone = await tx.parkingZone.findUnique({ where: { code: input.zoneCode } });
        if (!zone) throw managementErrors.zoneNotFound();
        if (zone.vehicleType !== input.vehicleType) throw managementErrors.slotVehicleMismatch();
        if (await tx.parkingSlot.count({ where: { code: input.code } })) {
          throw managementErrors.slotCodeTaken();
        }

        const last = await tx.parkingSlot.aggregate({
          where: { zoneId: zone.id },
          _max: { sortOrder: true },
        });
        const blocked = input.status === 'BLOCKED';
        const created = await tx.parkingSlot.create({
          data: {
            zoneId: zone.id,
            code: input.code,
            priority: input.priority,
            label: input.label ?? null,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
            status: blocked ? 'BLOCKED' : 'AVAILABLE',
            blockedReason: blocked ? (input.blockedReason ?? null) : null,
            isActive: input.status !== 'DISABLED',
          },
        });
        await audit(
          context,
          AUDIT_ACTIONS.slotCreated,
          AUDIT_ENTITY_TYPES.parkingSlot,
          created.code,
          {
            zone: zone.code,
            vehicleType: zone.vehicleType,
            priority: created.priority,
            status: input.status,
          },
          tx,
        );
        return loadSlot(tx, created.code);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'parking_slots_code_key'))
        throw managementErrors.slotCodeTaken();
      throw error;
    }
  },

  /** The next unused slot ID for a zone, e.g. T-11 after T-10 (archived IDs stay reserved). */
  async nextCode(zoneCode: string): Promise<NextSlotCodeResponse> {
    const zone = await prisma.parkingZone.findUnique({ where: { code: zoneCode } });
    if (!zone) throw managementErrors.zoneNotFound();
    const prefix = SLOT_CODE_PREFIX[zone.vehicleType];
    const existing = await prisma.parkingSlot.findMany({
      where: { code: { startsWith: `${prefix}-` } },
      select: { code: true },
    });
    const highest = existing.reduce((max, slot) => {
      const number = Number(slot.code.slice(prefix.length + 1));
      return Number.isInteger(number) ? Math.max(max, number) : max;
    }, 0);
    return { code: `${prefix}-${String(highest + 1).padStart(2, '0')}` };
  },

  /** Priority, label and (for a blocked slot) the block reason. The slot ID never changes. */
  async update(
    code: string,
    input: UpdateSlotInput,
    context: OperationContext,
  ): Promise<ManagedSlot> {
    return withTransaction(async (tx) => {
      const slot = await tx.parkingSlot.findFirst({ where: { code, ...VISIBLE } });
      if (!slot) throw managementErrors.slotNotFound();
      if (input.blockedReason !== undefined && slot.status !== 'BLOCKED') {
        throw managementErrors.slotNotBlocked();
      }

      await tx.parkingSlot.update({
        where: { id: slot.id },
        data: {
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.blockedReason !== undefined ? { blockedReason: input.blockedReason } : {}),
        },
      });
      await audit(
        context,
        input.priority !== undefined && input.priority !== slot.priority
          ? AUDIT_ACTIONS.slotPriorityChanged
          : AUDIT_ACTIONS.slotUpdated,
        AUDIT_ENTITY_TYPES.parkingSlot,
        code,
        {
          ...(input.priority !== undefined ? { from: slot.priority, to: input.priority } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.blockedReason !== undefined ? { blockedReason: input.blockedReason } : {}),
        },
        tx,
      );
      return loadSlot(tx, code);
    });
  },

  async block(code: string, reason: string, context: OperationContext): Promise<ManagedSlot> {
    return withTransaction(async (tx) => {
      const { count } = await tx.parkingSlot.updateMany({
        where: { code, status: 'AVAILABLE', isActive: true, ...VISIBLE },
        data: { status: 'BLOCKED', blockedReason: reason },
      });
      if (count !== 1) {
        throw await explainRefusal(tx, code, managementErrors.slotNotAvailable);
      }
      await audit(
        context,
        AUDIT_ACTIONS.slotBlocked,
        AUDIT_ENTITY_TYPES.parkingSlot,
        code,
        { reason },
        tx,
      );
      return loadSlot(tx, code);
    });
  },

  async unblock(code: string, context: OperationContext): Promise<ManagedSlot> {
    return withTransaction(async (tx) => {
      const { count } = await tx.parkingSlot.updateMany({
        where: { code, status: 'BLOCKED', ...VISIBLE },
        data: { status: 'AVAILABLE', blockedReason: null },
      });
      if (count !== 1) {
        const slot = await tx.parkingSlot.findUnique({ where: { code } });
        throw !slot || slot.archivedAt
          ? managementErrors.slotNotFound()
          : managementErrors.slotNotBlocked();
      }
      await audit(
        context,
        AUDIT_ACTIONS.slotUnblocked,
        AUDIT_ENTITY_TYPES.parkingSlot,
        code,
        {},
        tx,
      );
      return loadSlot(tx, code);
    });
  },

  async setPriority(
    code: string,
    priority: number,
    context: OperationContext,
  ): Promise<ManagedSlot> {
    return this.update(code, { priority }, context);
  },

  /** Takes a slot out of service: never offered for allocation, hidden from drivers. */
  async disable(code: string, context: OperationContext): Promise<ManagedSlot> {
    return withTransaction(async (tx) => {
      const slot = await tx.parkingSlot.findFirst({
        where: { code, ...VISIBLE },
        include: { _count: { select: { sessions: { where: { status: 'ACTIVE' } } } } },
      });
      if (!slot) throw managementErrors.slotNotFound();
      if (!slot.isActive) return loadSlot(tx, code);
      if (slotBusy(slot, slot._count.sessions)) throw managementErrors.slotInUse();

      // The status condition makes this lose cleanly to a concurrent allocation.
      const { count } = await tx.parkingSlot.updateMany({
        where: { id: slot.id, status: { in: ['AVAILABLE', 'BLOCKED'] }, isActive: true },
        data: { isActive: false },
      });
      if (count !== 1) throw managementErrors.slotInUse();
      await audit(
        context,
        AUDIT_ACTIONS.slotDisabled,
        AUDIT_ENTITY_TYPES.parkingSlot,
        code,
        {},
        tx,
      );
      return loadSlot(tx, code);
    });
  },

  async enable(code: string, context: OperationContext): Promise<ManagedSlot> {
    return withTransaction(async (tx) => {
      const slot = await tx.parkingSlot.findFirst({ where: { code, ...VISIBLE } });
      if (!slot) throw managementErrors.slotNotFound();
      if (slot.isActive) return loadSlot(tx, code);
      await tx.parkingSlot.update({ where: { id: slot.id }, data: { isActive: true } });
      await audit(context, AUDIT_ACTIONS.slotEnabled, AUDIT_ENTITY_TYPES.parkingSlot, code, {}, tx);
      return loadSlot(tx, code);
    });
  },

  /**
   * Deletes a slot that was never used, or archives one with parking history so
   * sessions, receipts and reports keep referring to it. A slot that has a
   * vehicle in it (or is being assigned) can never be removed.
   */
  async remove(code: string, context: OperationContext): Promise<DeleteSlotResponse> {
    return withTransaction(async (tx) => {
      const slot = await tx.parkingSlot.findFirst({
        where: { code, ...VISIBLE },
        include: {
          _count: { select: { sessions: true } },
        },
      });
      if (!slot) throw managementErrors.slotNotFound();

      const activeSessions = await tx.parkingSession.count({
        where: { slotId: slot.id, status: 'ACTIVE' },
      });
      if (slotBusy(slot, activeSessions)) throw managementErrors.slotInUse();

      const idle: Prisma.ParkingSlotWhereInput = {
        id: slot.id,
        status: { in: ['AVAILABLE', 'BLOCKED'] },
      };
      if (slot._count.sessions === 0) {
        const { count } = await tx.parkingSlot.deleteMany({ where: idle });
        if (count !== 1) throw managementErrors.slotInUse();
        await audit(
          context,
          AUDIT_ACTIONS.slotDeleted,
          AUDIT_ENTITY_TYPES.parkingSlot,
          code,
          {},
          tx,
        );
        return { code, outcome: 'DELETED' as const };
      }

      const { count } = await tx.parkingSlot.updateMany({
        where: idle,
        data: { isActive: false, archivedAt: new Date() },
      });
      if (count !== 1) throw managementErrors.slotInUse();
      await audit(
        context,
        AUDIT_ACTIONS.slotArchived,
        AUDIT_ENTITY_TYPES.parkingSlot,
        code,
        { sessions: slot._count.sessions },
        tx,
      );
      return { code, outcome: 'ARCHIVED' as const };
    });
  },

  /** Display name, description and in-service flag. Taking a block out of service needs it to be empty. */
  async updateBlock(
    code: string,
    input: UpdateBlockInput,
    context: OperationContext,
  ): Promise<ManagedBlock> {
    return withTransaction(async (tx) => {
      const block = await tx.parkingBlock.findUnique({ where: { code } });
      if (!block) throw managementErrors.blockNotFound();
      if (input.isActive === false && block.isActive) {
        const busy = await tx.parkingSlot.count({
          where: {
            zone: { blockId: block.id },
            OR: [
              { status: { in: ['OCCUPIED', 'HELD'] } },
              { sessions: { some: { status: 'ACTIVE' } } },
            ],
          },
        });
        if (busy) throw managementErrors.blockInUse();
      }
      await tx.parkingBlock.update({
        where: { id: block.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await audit(
        context,
        AUDIT_ACTIONS.blockUpdated,
        AUDIT_ENTITY_TYPES.parkingBlock,
        code,
        {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        tx,
      );
      const updated = await tx.parkingBlock.findUniqueOrThrow({
        where: { id: block.id },
        include: {
          zones: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], include: ZONE_INCLUDE },
        },
      });
      return toManagedBlock(updated, campusHour());
    });
  },

  /** Display name and in-service flag of a zone; its vehicle type never changes. */
  async updateZone(
    code: string,
    input: UpdateZoneInput,
    context: OperationContext,
  ): Promise<ManagedZone> {
    return withTransaction(async (tx) => {
      const zone = await tx.parkingZone.findUnique({ where: { code } });
      if (!zone) throw managementErrors.zoneNotFound();
      if (input.isActive === false && zone.isActive) {
        const busy = await tx.parkingSlot.count({
          where: {
            zoneId: zone.id,
            OR: [
              { status: { in: ['OCCUPIED', 'HELD'] } },
              { sessions: { some: { status: 'ACTIVE' } } },
            ],
          },
        });
        if (busy) throw managementErrors.zoneInUse();
      }
      await tx.parkingZone.update({
        where: { id: zone.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      await audit(
        context,
        AUDIT_ACTIONS.zoneUpdated,
        AUDIT_ENTITY_TYPES.parkingZone,
        code,
        {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        tx,
      );
      const updated = await tx.parkingZone.findUniqueOrThrow({
        where: { id: zone.id },
        include: ZONE_INCLUDE,
      });
      return toManagedZone(updated, campusHour());
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
