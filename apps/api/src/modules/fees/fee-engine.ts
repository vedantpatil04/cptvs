import type { FeeBreakdown, FeeLine, FeeSchedule, OwnerCategory, VehicleType } from '@cpvts/shared';

import { AppError } from '../../lib/errors.js';

/**
 * The single, authoritative CPVTS fee engine (Master Blueprint §16).
 *
 * Everything that shows or stores an amount — checkout, payment, receipt,
 * revenue, dashboards — uses these functions or the values they produced and
 * were persisted at finalization. Nothing else calculates fees.
 */

/**
 * Whole-hour competition model: duration = exit hour − entry hour.
 * No fractional hours and no rounding.
 */
export const calculateDurationHours = (entryHour: number, exitHour: number): number => {
  if (!Number.isInteger(entryHour) || !Number.isInteger(exitHour)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Hours must be whole numbers.');
  }
  if (exitHour < entryHour) {
    throw new AppError(400, 'EXIT_BEFORE_ENTRY', 'Exit hour cannot be earlier than entry hour.');
  }
  return exitHour - entryHour;
};

/** Applies the configured rule for the owner category and vehicle type. */
export const calculateFee = (
  schedule: FeeSchedule,
  ownerCategory: OwnerCategory,
  vehicleType: VehicleType,
  durationHours: number,
): FeeBreakdown => {
  if (!Number.isInteger(durationHours) || durationHours < 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Duration must be a whole number of hours.');
  }

  const rule = schedule.rules[ownerCategory][vehicleType];
  const lines: FeeLine[] = [];

  switch (rule.type) {
    case 'FREE':
      lines.push({ kind: 'FREE', hours: durationHours });
      break;
    case 'HOURLY':
      lines.push({
        kind: 'CHARGED',
        hours: durationHours,
        ratePaise: rule.hourlyRatePaise,
        amountPaise: durationHours * rule.hourlyRatePaise,
      });
      break;
    case 'FREE_HOURS_THEN_HOURLY': {
      const freeHours = Math.min(durationHours, rule.freeHours);
      const chargedHours = durationHours - freeHours;
      lines.push({ kind: 'FREE', hours: freeHours });
      if (chargedHours > 0) {
        lines.push({
          kind: 'CHARGED',
          hours: chargedHours,
          ratePaise: rule.hourlyRatePaise,
          amountPaise: chargedHours * rule.hourlyRatePaise,
        });
      }
      break;
    }
  }

  const totalPaise = lines.reduce(
    (sum, line) => sum + (line.kind === 'CHARGED' ? line.amountPaise : 0),
    0,
  );
  return { ownerCategory, vehicleType, durationHours, rule, lines, totalPaise };
};
