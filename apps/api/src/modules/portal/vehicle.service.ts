import {
  MAX_VEHICLES_PER_USER,
  type RegisteredVehicle,
  type RegisterVehicleRequest,
  type UpdateVehicleRequest,
} from '@cpvts/shared';

import type { DbClient } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import type { OperationContext } from '../parking/operation-context.js';
import { parkingErrors } from '../parking/parking.errors.js';

/** A registered vehicle with its live parking state. */
export const VEHICLE_VIEW_INCLUDE = {
  sessions: {
    where: { status: 'ACTIVE' },
    include: { slot: { include: { zone: { include: { block: true } } } } },
    take: 1,
  },
  _count: { select: { sessions: true } },
} as const satisfies Prisma.VehicleInclude;

type VehicleRow = Prisma.VehicleGetPayload<{ include: typeof VEHICLE_VIEW_INCLUDE }>;

export const toRegisteredVehicle = (vehicle: VehicleRow): RegisteredVehicle => {
  const active = vehicle.sessions[0];
  return {
    id: vehicle.id,
    vehicleNumber: vehicle.vehicleNumber,
    vehicleType: vehicle.vehicleType,
    label: vehicle.label,
    isPrimary: vehicle.isPrimary,
    registeredAt: (vehicle.ownerSince ?? vehicle.createdAt).toISOString(),
    // Parking history is tied to the plate and type, so they are fixed once it exists.
    identityEditable: vehicle._count.sessions === 0,
    activeSession: active
      ? {
          sessionNumber: active.sessionNumber,
          blockName: active.slot.zone.block.name,
          slotCode: active.slot.code,
          entryHour: active.entryHour,
          entryAt: active.entryAt.toISOString(),
        }
      : null,
  };
};

export const listVehiclesOf = async (
  userId: string,
  db: DbClient = prisma,
): Promise<RegisteredVehicle[]> => {
  const vehicles = await db.vehicle.findMany({
    where: { ownerUserId: userId },
    include: VEHICLE_VIEW_INCLUDE,
    orderBy: [{ isPrimary: 'desc' }, { ownerSince: 'asc' }, { vehicleNumber: 'asc' }],
  });
  return vehicles.map(toRegisteredVehicle);
};

const loadOwned = async (userId: string, vehicleId: string, db: DbClient): Promise<VehicleRow> => {
  const vehicle = await db.vehicle.findFirst({
    where: { id: vehicleId, ownerUserId: userId },
    include: VEHICLE_VIEW_INCLUDE,
  });
  if (!vehicle) throw accountErrors.vehicleNotFound();
  return vehicle;
};

const mapVehicleViolation = (error: unknown): never => {
  if (isUniqueViolation(error, 'vehicles_vehicle_number_key')) {
    throw accountErrors.vehicleAlreadyRegistered();
  }
  if (isUniqueViolation(error, 'vehicles_one_primary_per_owner')) {
    throw new AppError(
      409,
      'CONFLICT',
      'The primary vehicle was changed at the same time. Try again.',
    );
  }
  throw error;
};

/** A user's own vehicles. Only the owner can see or change them; anyone else gets "not found". */
export const vehicleService = {
  list: listVehiclesOf,

  async register(
    input: RegisterVehicleRequest,
    context: OperationContext,
  ): Promise<RegisteredVehicle> {
    const userId = context.actor.id;
    const vehicleNumber = input.vehicleNumber.trim().toUpperCase();
    try {
      const id = await withTransaction(async (tx) => {
        const owned = await tx.vehicle.count({ where: { ownerUserId: userId } });
        if (owned >= MAX_VEHICLES_PER_USER) {
          throw new AppError(
            409,
            'VEHICLE_LIMIT_REACHED',
            `You can register at most ${MAX_VEHICLES_PER_USER} vehicles.`,
          );
        }

        const now = new Date();
        const label = input.label ?? null;
        const existing = await tx.vehicle.findUnique({ where: { vehicleNumber } });
        let vehicleId: string;
        if (existing) {
          // A plate the security desk has seen before can be claimed once, if it is
          // unowned and of the same type. History from before the claim stays hidden.
          if (existing.ownerUserId) throw accountErrors.vehicleAlreadyRegistered();
          if (existing.vehicleType !== input.vehicleType) throw parkingErrors.vehicleTypeMismatch();
          const claimed = await tx.vehicle.updateMany({
            where: { id: existing.id, ownerUserId: null },
            data: { ownerUserId: userId, ownerSince: now, label, isPrimary: owned === 0 },
          });
          if (claimed.count !== 1) throw accountErrors.vehicleAlreadyRegistered();
          vehicleId = existing.id;
        } else {
          const created = await tx.vehicle.create({
            data: {
              vehicleNumber,
              vehicleType: input.vehicleType,
              ownerUserId: userId,
              ownerSince: now,
              label,
              isPrimary: owned === 0,
            },
            select: { id: true },
          });
          vehicleId = created.id;
        }

        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.vehicleRegistered,
            actorId: userId,
            entityType: AUDIT_ENTITY_TYPES.vehicle,
            entityId: vehicleNumber,
            metadata: { vehicleType: input.vehicleType, claimedExisting: Boolean(existing) },
            request: context.request,
          },
          tx,
        );
        return vehicleId;
      });
      return await loadOwned(userId, id, prisma).then(toRegisteredVehicle);
    } catch (error) {
      return mapVehicleViolation(error);
    }
  },

  /**
   * Label is always editable. Number and type only while the vehicle has no
   * parking history; category, verification, fees, sessions, payments and
   * receipts are not vehicle fields a user can touch at all.
   */
  async update(
    vehicleId: string,
    patch: UpdateVehicleRequest,
    context: OperationContext,
  ): Promise<RegisteredVehicle> {
    const userId = context.actor.id;
    try {
      await withTransaction(async (tx) => {
        const vehicle = await loadOwned(userId, vehicleId, tx);
        const number = patch.vehicleNumber?.trim().toUpperCase();
        const numberChanges = number !== undefined && number !== vehicle.vehicleNumber;
        const typeChanges =
          patch.vehicleType !== undefined && patch.vehicleType !== vehicle.vehicleType;
        if ((numberChanges || typeChanges) && vehicle._count.sessions > 0) {
          throw accountErrors.vehicleIdentityLocked();
        }

        const data: Prisma.VehicleUpdateInput = {};
        const changed: string[] = [];
        if (numberChanges) {
          data.vehicleNumber = number;
          changed.push('vehicleNumber');
        }
        if (typeChanges) {
          data.vehicleType = patch.vehicleType;
          changed.push('vehicleType');
        }
        if (patch.label !== undefined && (patch.label ?? null) !== vehicle.label) {
          data.label = patch.label ?? null;
          changed.push('label');
        }
        if (changed.length === 0) return;

        await tx.vehicle.update({ where: { id: vehicle.id }, data });
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.vehicleUpdated,
            actorId: userId,
            entityType: AUDIT_ENTITY_TYPES.vehicle,
            entityId: number ?? vehicle.vehicleNumber,
            metadata: { fields: changed },
            request: context.request,
          },
          tx,
        );
      });
    } catch (error) {
      mapVehicleViolation(error);
    }
    return toRegisteredVehicle(await loadOwned(userId, vehicleId, prisma));
  },

  async setPrimary(vehicleId: string, context: OperationContext): Promise<RegisteredVehicle> {
    const userId = context.actor.id;
    try {
      await withTransaction(async (tx) => {
        const vehicle = await loadOwned(userId, vehicleId, tx);
        if (vehicle.isPrimary) return;
        // Clear the old primary first: the database allows only one per owner.
        await tx.vehicle.updateMany({
          where: { ownerUserId: userId, isPrimary: true },
          data: { isPrimary: false },
        });
        await tx.vehicle.update({ where: { id: vehicle.id }, data: { isPrimary: true } });
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.vehicleUpdated,
            actorId: userId,
            entityType: AUDIT_ENTITY_TYPES.vehicle,
            entityId: vehicle.vehicleNumber,
            metadata: { fields: ['isPrimary'] },
            request: context.request,
          },
          tx,
        );
      });
    } catch (error) {
      mapVehicleViolation(error);
    }
    return toRegisteredVehicle(await loadOwned(userId, vehicleId, prisma));
  },
};
