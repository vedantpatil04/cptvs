import type {
  AdminVehicleItem,
  adminVehicleQuerySchema,
  Page,
  VehicleReleaseResult,
} from '@cpvts/shared';
import type { z } from 'zod';

import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import type { OperationContext } from '../parking/operation-context.js';
import { releaseVehicleOwnership } from '../portal/vehicle.service.js';

type Query = z.output<typeof adminVehicleQuerySchema>;

const INCLUDE = {
  owner: {
    select: {
      id: true,
      fullName: true,
      isActive: true,
      parkingProfile: {
        select: { category: true, institutionalId: true, verificationStatus: true },
      },
    },
  },
  _count: { select: { sessions: true } },
  sessions: {
    where: { status: 'ACTIVE' },
    include: { slot: { include: { zone: { include: { block: true } } } } },
    take: 1,
  },
} as const satisfies Prisma.VehicleInclude;

type VehicleRow = Prisma.VehicleGetPayload<{ include: typeof INCLUDE }>;

const toItem = (vehicle: VehicleRow): AdminVehicleItem => {
  const owner = vehicle.owner;
  const profile = owner?.parkingProfile;
  const active = vehicle.sessions[0];
  return {
    id: vehicle.id,
    vehicleNumber: vehicle.vehicleNumber,
    vehicleType: vehicle.vehicleType,
    label: vehicle.label,
    owner:
      owner && profile && vehicle.ownerSince
        ? {
            userId: owner.id,
            fullName: owner.fullName,
            category: profile.category,
            institutionalId: profile.institutionalId,
            verificationStatus: profile.verificationStatus,
            isActive: owner.isActive,
            since: vehicle.ownerSince.toISOString(),
          }
        : null,
    sessionCount: vehicle._count.sessions,
    activeSession: active
      ? {
          sessionNumber: active.sessionNumber,
          blockName: active.slot.zone.block.name,
          slotCode: active.slot.code,
          entryAt: active.entryAt.toISOString(),
        }
      : null,
    firstSeenAt: vehicle.createdAt.toISOString(),
  };
};

/**
 * Vehicle ownership lookup for administrators: which account actively owns a plate. A plate
 * has at most one owner at a time (one row per plate, enforced by the database).
 */
export const adminVehicleService = {
  async search(query: Query): Promise<Page<AdminVehicleItem>> {
    const where: Prisma.VehicleWhereInput = {
      ...(query.q ? { vehicleNumber: { contains: query.q } } : {}),
      ...(query.owned === 'OWNED' ? { ownerUserId: { not: null } } : {}),
      ...(query.owned === 'UNOWNED' ? { ownerUserId: null } : {}),
      ...(query.vehicleType ? { vehicleType: query.vehicleType } : {}),
    };
    const [total, vehicles] = await Promise.all([
      prisma.vehicle.count({ where }),
      prisma.vehicle.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ vehicleNumber: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: vehicles.map(toItem), page: query.page, pageSize: query.pageSize, total };
  },

  async get(id: string): Promise<AdminVehicleItem> {
    const vehicle = await prisma.vehicle.findUnique({ where: { id }, include: INCLUDE });
    if (!vehicle) throw accountErrors.vehicleNotFound();
    return toItem(vehicle);
  },

  /** Ends the account's ownership of the plate (the owner can also do this themselves). */
  release(id: string, context: OperationContext): Promise<VehicleReleaseResult> {
    return releaseVehicleOwnership(id, context);
  },
};
