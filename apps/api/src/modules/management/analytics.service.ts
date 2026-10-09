import {
  OWNER_CATEGORIES,
  VEHICLE_TYPES,
  type AnalyticsResponse,
  type OwnerCategory,
  type VehicleType,
  type ZoneUsage,
} from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { campusDateString, campusHour } from '../../lib/campus-time.js';
import { IN_SERVICE } from '../parking/slot-filters.js';
import { resolveRange } from './date-range.js';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

interface DaySession {
  entryHour: number;
  exitHour: number | null;
  status: 'ACTIVE' | 'COMPLETED';
  durationHours: number | null;
  vehicleType: VehicleType;
  slot: { code: string; zone: { code: string; name: string } };
}

/**
 * Whole-hour occupancy model: a vehicle occupies hour h when entry ≤ h < exit.
 * A still-active session occupies hours up to the current hour (today) or
 * to the end of the day (earlier dates).
 */
const occupies = (session: DaySession, hour: number, lastActiveHour: number): boolean =>
  session.entryHour <= hour &&
  (session.status === 'COMPLETED' ? hour < (session.exitHour ?? 0) : hour <= lastActiveHour);

/** Parking analytics for one campus day (Master Blueprint §25). No ML — counts only. */
export const analyticsService = {
  /** `currentHour` defaults to the campus clock (injectable for tests). */
  async forDate(date?: string, currentHour = campusHour()): Promise<AnalyticsResponse> {
    const {
      from: day,
      start,
      end,
    } = resolveRange({ from: date ?? campusDateString(), to: date ?? campusDateString() });
    const isToday = day === campusDateString();
    const lastActiveHour = isToday ? currentHour : 23;

    const [sessions, receipts, zones] = await Promise.all([
      prisma.parkingSession.findMany({
        where: { entryAt: { gte: start, lt: end } },
        select: {
          entryHour: true,
          exitHour: true,
          status: true,
          durationHours: true,
          vehicleType: true,
          slot: { select: { code: true, zone: { select: { code: true, name: true } } } },
        },
      }),
      prisma.receipt.findMany({
        where: { issuedAt: { gte: start, lt: end } },
        select: {
          amountPaise: true,
          session: { select: { vehicleType: true, ownerCategory: true } },
        },
      }),
      prisma.parkingZone.findMany({
        where: { isActive: true, block: { isActive: true } },
        orderBy: [{ block: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
        select: {
          code: true,
          name: true,
          vehicleType: true,
          slots: { where: IN_SERVICE, select: { status: true } },
        },
      }),
    ]);

    const occupancyByHour = HOURS.map((hour: number) => {
      const row = { hour, TWO_WHEELER: 0, FOUR_WHEELER: 0 };
      for (const session of sessions) {
        if (occupies(session, hour, lastActiveHour)) {
          row[session.vehicleType] = (row[session.vehicleType] ?? 0) + 1;
        }
      }
      return row;
    });

    const entriesByHour = HOURS.map((hour: number) => ({
      hour,
      count: sessions.filter((session) => session.entryHour === hour).length,
    }));
    const peak = entriesByHour.reduce(
      (best: { hour: number; count: number }, row: { hour: number; count: number }) =>
        row.count > best.count ? row : best,
      {
        hour: -1,
        count: 0,
      },
    );

    const completed = sessions.filter((session) => session.status === 'COMPLETED');
    const totalDuration = completed.reduce(
      (sum: number, session) => sum + (session.durationHours ?? 0),
      0,
    );

    const byVehicleType = Object.fromEntries(VEHICLE_TYPES.map((key) => [key, 0])) as Record<
      VehicleType,
      number
    >;
    const byOwnerCategory = Object.fromEntries(OWNER_CATEGORIES.map((key) => [key, 0])) as Record<
      OwnerCategory,
      number
    >;
    for (const receipt of receipts) {
      const vt = receipt.session.vehicleType;
      byVehicleType[vt] = (byVehicleType[vt] ?? 0) + receipt.amountPaise;
      const oc = receipt.session.ownerCategory;
      byOwnerCategory[oc] = (byOwnerCategory[oc] ?? 0) + receipt.amountPaise;
    }

    const zoneUsage: ZoneUsage[] = zones.map((zone) => {
      const inZone = sessions.filter((session) => session.slot.zone.code === zone.code);
      const totalSlots = zone.slots.length;
      const usableSlots = zone.slots.filter((slot) => slot.status !== 'BLOCKED').length;
      const currentOccupied = zone.slots.filter(
        (slot) => slot.status === 'OCCUPIED' || slot.status === 'HELD',
      ).length;
      const peakOccupied = Math.max(
        0,
        ...HOURS.map(
          (hour) => inZone.filter((session) => occupies(session, hour, lastActiveHour)).length,
        ),
      );
      return {
        code: zone.code,
        name: zone.name,
        vehicleType: zone.vehicleType,
        totalSlots,
        usableSlots,
        sessions: inZone.length,
        peakOccupied,
        peakOccupancyPercent: percent(peakOccupied, usableSlots),
        currentOccupied,
        currentOccupancyPercent: percent(currentOccupied, usableSlots),
      };
    });

    const slotCounts = new Map<string, { slotCode: string; zoneName: string; sessions: number }>();
    for (const session of sessions) {
      const entry = slotCounts.get(session.slot.code) ?? {
        slotCode: session.slot.code,
        zoneName: session.slot.zone.name,
        sessions: 0,
      };
      entry.sessions += 1;
      slotCounts.set(session.slot.code, entry);
    }

    return {
      date: day,
      generatedAt: new Date().toISOString(),
      occupancyByHour,
      entriesByHour,
      peakEntryHour: peak.count > 0 ? peak.hour : null,
      sessions: {
        entered: sessions.length,
        completed: completed.length,
        averageDurationHours: completed.length
          ? Math.round((totalDuration / completed.length) * 10) / 10
          : null,
      },
      revenue: {
        totalPaise: receipts.reduce((sum, receipt) => sum + receipt.amountPaise, 0),
        transactions: receipts.length,
        byVehicleType,
        byOwnerCategory,
      },
      zones: zoneUsage,
      topSlots: [...slotCounts.values()]
        .sort((a, b) => b.sessions - a.sessions || a.slotCode.localeCompare(b.slotCode))
        .slice(0, 5),
    };
  },
};
