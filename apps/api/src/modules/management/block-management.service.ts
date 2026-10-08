import type {
  CreateBlockInput,
  CreateZoneInput,
  ManagedBlock,
  UpdateBlockRequest,
  UpdateZoneRequest,
} from '@cpvts/shared';

import { isUniqueViolation } from '../../db/errors.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { OperationContext } from '../parking/operation-context.js';
import { managementErrors } from './management.errors.js';
import { loadManagedBlock } from './slot-management.service.js';

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

/** Vehicles parked, or slots temporarily held, in the given zones. */
const hasLiveUse = async (tx: Prisma.TransactionClient, zoneWhere: Prisma.ParkingZoneWhereInput) =>
  (await tx.parkingSlot.count({
    where: { zone: zoneWhere, status: { in: ['OCCUPIED', 'HELD'] } },
  })) > 0;

const definedOnly = <T extends object>(patch: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;

/**
 * Parking block and zone configuration (Administrator): name, vehicle type,
 * active state, layout order and the block's real-world coordinates. A zone
 * accepts exactly one vehicle type, and slots of an inactive block or zone
 * are not allocated. Coordinates are only ever entered by an administrator.
 */
export const blockManagementService = {
  async createBlock(input: CreateBlockInput, context: OperationContext): Promise<ManagedBlock> {
    try {
      await withTransaction(async (tx) => {
        if (await tx.parkingBlock.findUnique({ where: { code: input.code } })) {
          throw managementErrors.blockCodeTaken();
        }
        const last = await tx.parkingBlock.aggregate({ _max: { sortOrder: true } });
        await tx.parkingBlock.create({
          data: {
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            latitude: input.latitude ?? null,
            longitude: input.longitude ?? null,
            sortOrder: input.sortOrder ?? (last._max.sortOrder ?? -1) + 1,
          },
        });
        await audit(
          context,
          AUDIT_ACTIONS.blockCreated,
          AUDIT_ENTITY_TYPES.parkingBlock,
          input.code,
          { name: input.name },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'parking_blocks_code_key'))
        throw managementErrors.blockCodeTaken();
      throw error;
    }
    return loadManagedBlock(input.code);
  },

  async updateBlock(
    code: string,
    patch: UpdateBlockRequest,
    context: OperationContext,
  ): Promise<ManagedBlock> {
    await withTransaction(async (tx) => {
      const block = await tx.parkingBlock.findUnique({ where: { code } });
      if (!block) throw managementErrors.blockNotFound();
      const data = definedOnly(patch);
      if (patch.isActive === false && block.isActive) {
        if (await hasLiveUse(tx, { blockId: block.id })) throw managementErrors.blockInUse();
      }
      if (Object.keys(data).length === 0) return;
      await tx.parkingBlock.update({ where: { code }, data });
      await audit(
        context,
        AUDIT_ACTIONS.blockUpdated,
        AUDIT_ENTITY_TYPES.parkingBlock,
        code,
        { fields: Object.keys(data) },
        tx,
      );
    });
    return loadManagedBlock(code);
  },

  async createZone(request: CreateZoneInput, context: OperationContext): Promise<ManagedBlock> {
    try {
      await withTransaction(async (tx) => {
        const block = await tx.parkingBlock.findUnique({ where: { code: request.blockCode } });
        if (!block) throw managementErrors.blockNotFound();
        if (await tx.parkingZone.findUnique({ where: { code: request.code } })) {
          throw managementErrors.zoneCodeTaken();
        }
        const last = await tx.parkingZone.aggregate({
          where: { blockId: block.id },
          _max: { sortOrder: true },
        });
        await tx.parkingZone.create({
          data: {
            blockId: block.id,
            code: request.code,
            name: request.name,
            vehicleType: request.vehicleType,
            sortOrder: request.sortOrder ?? (last._max.sortOrder ?? -1) + 1,
          },
        });
        await audit(
          context,
          AUDIT_ACTIONS.zoneCreated,
          AUDIT_ENTITY_TYPES.parkingZone,
          request.code,
          { block: block.code, vehicleType: request.vehicleType },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'parking_zones_code_key'))
        throw managementErrors.zoneCodeTaken();
      throw error;
    }
    return loadManagedBlock(request.blockCode);
  },

  /** The vehicle type can change only while the zone has no slots; deactivation needs no parked vehicle. */
  async updateZone(
    code: string,
    patch: UpdateZoneRequest,
    context: OperationContext,
  ): Promise<ManagedBlock> {
    const blockCode = await withTransaction(async (tx) => {
      const zone = await tx.parkingZone.findUnique({
        where: { code },
        include: { block: { select: { code: true } }, _count: { select: { slots: true } } },
      });
      if (!zone) throw managementErrors.zoneNotFound();

      if (
        patch.vehicleType !== undefined &&
        patch.vehicleType !== zone.vehicleType &&
        zone._count.slots > 0
      ) {
        throw managementErrors.zoneInUse();
      }
      if (patch.isActive === false && zone.isActive && (await hasLiveUse(tx, { id: zone.id }))) {
        throw managementErrors.zoneInUse();
      }

      const data = definedOnly(patch);
      if (Object.keys(data).length > 0) {
        await tx.parkingZone.update({ where: { code }, data });
        await audit(
          context,
          AUDIT_ACTIONS.zoneUpdated,
          AUDIT_ENTITY_TYPES.parkingZone,
          code,
          { fields: Object.keys(data) },
          tx,
        );
      }
      return zone.block.code;
    });
    return loadManagedBlock(blockCode);
  },
};
