import type { AlertsResponse, ParkingAlert } from '@cpvts/shared';

import { config } from '../../config/index.js';
import { prisma } from '../../db/prisma.js';
import { campusHour } from '../../lib/campus-time.js';
import { currentDuration } from './parking.mappers.js';
import { slotHoldRepository } from './slot-hold.repository.js';

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

/**
 * Rule-based operational alerts (Master Blueprint §26). Transparent
 * thresholds from configuration; no prediction or ML.
 */
export const alertsService = {
  async list(): Promise<AlertsResponse> {
    await slotHoldRepository.releaseExpired();
    const { nearlyFullPercent, longDurationHours } = config.alerts;
    const hour = campusHour();

    const [zones, active] = await Promise.all([
      prisma.parkingZone.findMany({
        where: { isActive: true, block: { isActive: true } },
        orderBy: [{ block: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
        include: { slots: { orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] } },
      }),
      prisma.parkingSession.findMany({
        where: { status: 'ACTIVE' },
        include: { vehicle: true, slot: true },
      }),
    ]);

    const alerts: ParkingAlert[] = [];

    for (const zone of zones) {
      if (zone.slots.length === 0) continue;
      const usable = zone.slots.filter((slot) => slot.status !== 'BLOCKED').length;
      const occupied = zone.slots.filter(
        (slot) => slot.status === 'OCCUPIED' || slot.status === 'HELD',
      ).length;
      const percent = usable > 0 ? Math.round((occupied / usable) * 1000) / 10 : 100;
      const summary = {
        code: zone.code,
        name: zone.name,
        vehicleType: zone.vehicleType,
        occupied,
        usable,
        percent,
        availableSlots: zone.slots
          .filter((slot) => slot.status === 'AVAILABLE')
          .map((slot) => slot.code),
      };
      if (occupied >= usable)
        alerts.push({ kind: 'ZONE_FULL', severity: 'critical', zone: summary });
      else if (percent >= nearlyFullPercent) {
        alerts.push({ kind: 'ZONE_NEARLY_FULL', severity: 'warning', zone: summary });
      }

      for (const slot of zone.slots.filter((s) => s.status === 'BLOCKED')) {
        alerts.push({
          kind: 'SLOT_BLOCKED',
          severity: 'info',
          slot: { code: slot.code, zoneName: zone.name, reason: slot.blockedReason },
        });
      }
    }

    for (const session of active) {
      const durationHours = currentDuration(session.entryHour, hour);
      if (durationHours >= longDurationHours) {
        alerts.push({
          kind: 'LONG_DURATION',
          severity: 'warning',
          session: {
            sessionNumber: session.sessionNumber,
            vehicleNumber: session.vehicle.vehicleNumber,
            slotCode: session.slot.code,
            durationHours,
          },
        });
      }
    }

    alerts.sort((a, b) => {
      const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (bySeverity !== 0) return bySeverity;
      if (a.kind === 'LONG_DURATION' && b.kind === 'LONG_DURATION') {
        return b.session.durationHours - a.session.durationHours;
      }
      return 0;
    });

    return {
      generatedAt: new Date().toISOString(),
      thresholds: { nearlyFullPercent, longDurationHours },
      alerts,
    };
  },
};
