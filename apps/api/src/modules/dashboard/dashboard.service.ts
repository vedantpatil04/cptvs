import {
  VEHICLE_TYPES,
  type DashboardSummary,
  type OccupancySummary,
  type UserRole,
} from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { campusDayStart } from '../../lib/campus-time.js';
import { slotHoldRepository } from '../parking/slot-hold.repository.js';
import { publicRepository, type SlotStatusCount } from '../public/public.repository.js';

const summarise = (counts: SlotStatusCount[]): OccupancySummary => {
  const of = (status: SlotStatusCount['status']) =>
    counts.filter((entry) => entry.status === status).reduce((sum, entry) => sum + entry.count, 0);
  const available = of('AVAILABLE');
  const occupied = of('OCCUPIED');
  const blocked = of('BLOCKED');
  const held = of('HELD');
  const total = available + occupied + blocked + held;
  const usable = total - blocked;
  return {
    total,
    available,
    occupied,
    blocked,
    held,
    occupancyPercent: usable > 0 ? Math.round(((occupied + held) / usable) * 1000) / 10 : 0,
  };
};

export const dashboardService = {
  /**
   * Live operational summary. Revenue comes only from finalized receipts and
   * is included for administrators only.
   */
  async getSummary(role: UserRole): Promise<DashboardSummary> {
    await slotHoldRepository.releaseExpired();
    const todayStart = campusDayStart();

    const [counts, currentlyParked, todayVehicleCount, revenue] = await Promise.all([
      publicRepository.countSlotsByVehicleTypeAndStatus(),
      prisma.parkingSession.count({ where: { status: 'ACTIVE' } }),
      prisma.parkingSession.count({ where: { entryAt: { gte: todayStart } } }),
      role === 'ADMIN'
        ? prisma.receipt.aggregate({
            where: { issuedAt: { gte: todayStart } },
            _sum: { amountPaise: true },
          })
        : null,
    ]);

    return {
      generatedAt: new Date().toISOString(),
      overall: summarise(counts),
      byVehicleType: VEHICLE_TYPES.map((vehicleType) => ({
        vehicleType,
        ...summarise(counts.filter((entry) => entry.vehicleType === vehicleType)),
      })),
      currentlyParked,
      todayVehicleCount,
      todayFeesCollectedPaise: revenue ? (revenue._sum.amountPaise ?? 0) : null,
    };
  },
};
