import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Sessions a parking user may see: those of their registered vehicles that
 * began after they took ownership. A previous owner's (or a visitor's)
 * parking history never becomes visible by registering the same vehicle.
 */
export const ownedSessionWhere = async (
  userId: string,
  db: DbClient = prisma,
): Promise<Prisma.ParkingSessionWhereInput> => {
  const vehicles = await db.vehicle.findMany({
    where: { ownerUserId: userId },
    select: { id: true, ownerSince: true },
  });
  if (vehicles.length === 0) return { id: { in: [] } };
  return {
    OR: vehicles.map((vehicle) => ({
      vehicleId: vehicle.id,
      ...(vehicle.ownerSince ? { entryAt: { gte: vehicle.ownerSince } } : {}),
    })),
  };
};

const VEHICLE_LIST_INCLUDE = {
  _count: { select: { sessions: true } },
  sessions: {
    where: { status: 'ACTIVE' },
    take: 1,
    include: { slot: { include: { zone: { include: { block: true } } } } },
  },
} as const satisfies Prisma.VehicleInclude;

export type PortalVehicleRow = Prisma.VehicleGetPayload<{ include: typeof VEHICLE_LIST_INCLUDE }>;

export const portalRepository = {
  findProfile(userId: string, db: DbClient = prisma) {
    return db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        createdAt: true,
        parkingProfile: true,
        _count: { select: { vehicles: true } },
      },
    });
  },

  listVehicles(userId: string, db: DbClient = prisma) {
    return db.vehicle.findMany({
      where: { ownerUserId: userId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      include: VEHICLE_LIST_INCLUDE,
    });
  },

  findOwnedVehicle(userId: string, vehicleId: string, db: DbClient = prisma) {
    return db.vehicle.findFirst({
      where: { id: vehicleId, ownerUserId: userId },
      include: { _count: { select: { sessions: true } } },
    });
  },
};
