import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import type { SlotStatus, VehicleType } from '../../generated/prisma/client.js';

const ACTIVE_ZONE = { isActive: true, block: { isActive: true } } as const;

export interface SlotStatusCount {
  vehicleType: VehicleType;
  status: SlotStatus;
  count: number;
}

/**
 * Read-only queries behind the public overview. They return aggregates and
 * block-level information only — never slot codes, vehicles or sessions.
 */
export const publicRepository = {
  /** Number of slots per vehicle type and status, in active zones of active blocks. */
  async countSlotsByVehicleTypeAndStatus(db: DbClient = prisma): Promise<SlotStatusCount[]> {
    const [zones, groups] = await Promise.all([
      db.parkingZone.findMany({ where: ACTIVE_ZONE, select: { id: true, vehicleType: true } }),
      db.parkingSlot.groupBy({
        by: ['zoneId', 'status'],
        where: { zone: ACTIVE_ZONE },
        _count: { _all: true },
      }),
    ]);

    const vehicleTypeByZone = new Map(zones.map((zone) => [zone.id, zone.vehicleType]));
    const totals = new Map<string, SlotStatusCount>();
    for (const group of groups) {
      const vehicleType = vehicleTypeByZone.get(group.zoneId);
      if (!vehicleType) continue;
      const key = `${vehicleType}:${group.status}`;
      const entry = totals.get(key) ?? { vehicleType, status: group.status, count: 0 };
      entry.count += group._count._all;
      totals.set(key, entry);
    }
    return [...totals.values()];
  },

  /** Active parking blocks with the vehicle types of their active zones. */
  findActiveBlocks(db: DbClient = prisma) {
    return db.parkingBlock.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        code: true,
        name: true,
        description: true,
        latitude: true,
        longitude: true,
        zones: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { vehicleType: true },
        },
      },
    });
  },
};
