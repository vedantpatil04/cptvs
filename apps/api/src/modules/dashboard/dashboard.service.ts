import {
  VEHICLE_TYPES,
  type DashboardSummary,
  type OccupancySummary,
  type UserRole,
} from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { campusDayStart } from '../../lib/campus-time.js';
import { HISTORY_INCLUDE, toHistoryItem } from '../management/history.service.js';
import { slotHoldRepository } from '../parking/slot-hold.repository.js';
import { adminUserService } from '../users/admin-user.service.js';
import { publicRepository, type SlotStatusCount } from '../public/public.repository.js';

const RECENT_ACTIVITY = 8;

const summarise = (counts: SlotStatusCount[]): OccupancySummary => {
  const of = (status: SlotStatusCount['status']) =>
    counts
      .filter((entry: SlotStatusCount) => entry.status === status)
      .reduce((sum: number, entry: SlotStatusCount) => sum + entry.count, 0);
  const available = of('AVAILABLE');
  const occupied = of('OCCUPIED');
  const blocked = of('BLOCKED');
  const held = of('HELD');
  const reserved = of('RESERVED');
  const total = available + occupied + blocked + held + reserved;
  // Blocked and VIP-reserved slots are not usable capacity for the public.
  const usable = total - blocked - reserved;
  return {
    total,
    available,
    occupied,
    blocked,
    held,
    reserved,
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

    const isAdmin = role === 'ADMIN';
    const [counts, currentlyParked, todayVehicleCount, revenue, users, recent] = await Promise.all([
      publicRepository.countSlotsByVehicleTypeAndStatus(),
      prisma.parkingSession.count({ where: { status: 'ACTIVE' } }),
      prisma.parkingSession.count({ where: { entryAt: { gte: todayStart } } }),
      isAdmin
        ? prisma.receipt.aggregate({
            where: { issuedAt: { gte: todayStart } },
            _sum: { amountPaise: true },
          })
        : null,
      isAdmin ? adminUserService.counts() : null,
      isAdmin
        ? prisma.parkingSession.findMany({
            include: HISTORY_INCLUDE,
            orderBy: [{ entryAt: 'desc' }, { sessionNumber: 'asc' }],
            take: RECENT_ACTIVITY,
          })
        : null,
    ]);

    return {
      generatedAt: new Date().toISOString(),
      overall: summarise(counts),
      byVehicleType: VEHICLE_TYPES.map((vehicleType) => ({
        vehicleType,
        ...summarise(counts.filter((entry: SlotStatusCount) => entry.vehicleType === vehicleType)),
      })),
      currentlyParked,
      todayVehicleCount,
      todayFeesCollectedPaise: revenue ? (revenue._sum.amountPaise ?? 0) : null,
      users,
      recentActivity: recent ? recent.map((item) => toHistoryItem(item)) : null,
    };
  },
};
