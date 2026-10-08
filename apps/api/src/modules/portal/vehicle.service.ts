import type {
  RegisteredVehicle,
  RegisterVehicleRequest,
  UpdateVehicleRequest,
  VehicleType,
} from '@cpvts/shared';

import { isUniqueViolation } from '../../db/errors.js';
import { withTransaction } from '../../db/transaction.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { OperationContext } from '../parking/operation-context.js';
import { parkingErrors } from '../parking/parking.errors.js';
import { portalRepository, type PortalVehicleRow } from './portal.repository.js';

/** Parsed vehicle bodies (normalised by the shared schemas). */
interface NewVehicle {
  vehicleNumber: string;
  vehicleType: VehicleType;
  label?: string | null;
}
type VehicleChanges = Partial<NewVehicle>;

export const toRegisteredVehicle = (vehicle: PortalVehicleRow): RegisteredVehicle => {
  const active = vehicle.sessions.find(
    (session) => !vehicle.ownerSince || session.entryAt >= vehicle.ownerSince,
  );
  return {
    id: vehicle.id,
    vehicleNumber: vehicle.vehicleNumber,
    vehicleType: vehicle.vehicleType,
    label: vehicle.label,
    isPrimary: vehicle.isPrimary,
    registeredAt: (vehicle.ownerSince ?? vehicle.createdAt).toISOString(),
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

const NUMBER_CONSTRAINT = 'vehicles_vehicle_number_key';

export const vehicleService = {
  async list(userId: string): Promise<RegisteredVehicle[]> {
    const vehicles = await portalRepository.listVehicles(userId);
    return vehicles.map(toRegisteredVehicle);
  },

  async get(userId: string, vehicleId: string): Promise<RegisteredVehicle> {
    const vehicles = await portalRepository.listVehicles(userId);
    const vehicle = vehicles.find((entry) => entry.id === vehicleId);
    if (!vehicle) throw accountErrors.vehicleNotFound();
    return toRegisteredVehicle(vehicle);
  },

  /**
   * Registers a vehicle to the user. An unowned vehicle that has parked before
   * (for example as a visitor) can be claimed, but only its future sessions
   * become visible to the new owner. Owner category, fees, slots and sessions
   * are never taken from the request.
   */
  async register(
    input: RegisterVehicleRequest,
    context: OperationContext,
  ): Promise<RegisteredVehicle> {
    const userId = context.actor.id;
    const { vehicleNumber, vehicleType, label } = input as NewVehicle;

    try {
      const vehicleId = await withTransaction(async (tx) => {
        const existing = await tx.vehicle.findUnique({ where: { vehicleNumber } });
        if (existing?.ownerUserId) throw accountErrors.vehicleAlreadyRegistered();
        if (existing && existing.vehicleType !== vehicleType) {
          throw parkingErrors.vehicleTypeMismatch();
        }

        const isFirst = (await tx.vehicle.count({ where: { ownerUserId: userId } })) === 0;
        const ownership = {
          ownerUserId: userId,
          ownerSince: new Date(),
          label: label ?? null,
          isPrimary: isFirst,
        };
        const vehicle = existing
          ? await tx.vehicle.update({ where: { id: existing.id }, data: ownership })
          : await tx.vehicle.create({ data: { vehicleNumber, vehicleType, ...ownership } });

        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.vehicleRegistered,
            actorId: userId,
            entityType: AUDIT_ENTITY_TYPES.vehicle,
            entityId: vehicle.vehicleNumber,
            metadata: { vehicleType, claimedExisting: Boolean(existing) },
            request: context.request,
          },
          tx,
        );
        return vehicle.id;
      });
      return await this.get(userId, vehicleId);
    } catch (error) {
      if (isUniqueViolation(error, NUMBER_CONSTRAINT)) {
        throw accountErrors.vehicleAlreadyRegistered();
      }
      throw error;
    }
  },

  /** Label always; number and type only while the vehicle has no parking history. */
  async update(
    vehicleId: string,
    input: UpdateVehicleRequest,
    context: OperationContext,
  ): Promise<RegisteredVehicle> {
    const userId = context.actor.id;
    const changes = input as VehicleChanges;

    try {
      await withTransaction(async (tx) => {
        const vehicle = await portalRepository.findOwnedVehicle(userId, vehicleId, tx);
        if (!vehicle) throw accountErrors.vehicleNotFound();

        const numberChanges =
          changes.vehicleNumber !== undefined && changes.vehicleNumber !== vehicle.vehicleNumber;
        const typeChanges =
          changes.vehicleType !== undefined && changes.vehicleType !== vehicle.vehicleType;
        if ((numberChanges || typeChanges) && vehicle._count.sessions > 0) {
          throw accountErrors.vehicleIdentityLocked();
        }
        if (numberChanges) {
          const taken = await tx.vehicle.findUnique({
            where: { vehicleNumber: changes.vehicleNumber },
            select: { id: true },
          });
          if (taken) throw accountErrors.vehicleAlreadyRegistered();
        }

        await tx.vehicle.update({
          where: { id: vehicle.id },
          data: {
            ...(numberChanges ? { vehicleNumber: changes.vehicleNumber } : {}),
            ...(typeChanges ? { vehicleType: changes.vehicleType } : {}),
            ...(changes.label !== undefined ? { label: changes.label } : {}),
          },
        });
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.vehicleUpdated,
            actorId: userId,
            entityType: AUDIT_ENTITY_TYPES.vehicle,
            entityId: numberChanges ? changes.vehicleNumber : vehicle.vehicleNumber,
            metadata: { numberChanged: numberChanges, typeChanged: typeChanges },
            request: context.request,
          },
          tx,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, NUMBER_CONSTRAINT)) {
        throw accountErrors.vehicleAlreadyRegistered();
      }
      throw error;
    }
    return this.get(userId, vehicleId);
  },

  async setPrimary(vehicleId: string, context: OperationContext): Promise<RegisteredVehicle> {
    const userId = context.actor.id;
    await withTransaction(async (tx) => {
      const vehicle = await portalRepository.findOwnedVehicle(userId, vehicleId, tx);
      if (!vehicle) throw accountErrors.vehicleNotFound();
      // Clear first: the database allows one primary vehicle per owner.
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
          metadata: { primary: true },
          request: context.request,
        },
        tx,
      );
    });
    return this.get(userId, vehicleId);
  },
};
