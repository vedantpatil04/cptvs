import type { VehicleType } from '@cpvts/shared';

import { campusDayStart } from '../../lib/campus-time.js';
import { rankCandidates, type AllocationCandidate, type RankedCandidate } from './allocation.js';
import { parkingErrors } from './parking.errors.js';
import { parkingRepository } from './parking.repository.js';
import { slotHoldRepository } from './slot-hold.repository.js';

/**
 * Zone identification and candidate ranking shared by every way of starting a
 * session (the security desk and Park Now), so both use exactly the same
 * deterministic rules:
 *
 *  1. only slots of active zones for the vehicle type, in service (enabled and
 *     not archived) — a slot an administrator adds is eligible immediately;
 *  2. only AVAILABLE slots (OCCUPIED, BLOCKED and HELD are excluded);
 *  3. ranked best-first by `rankCandidates`.
 *
 * Throws `ZONE_NOT_CONFIGURED` or `ZONE_FULL` when nothing can be offered.
 */
export const loadRankedCandidates = async (
  vehicleType: VehicleType,
  now = new Date(),
): Promise<RankedCandidate[]> => {
  await slotHoldRepository.releaseExpired();
  const slots = await parkingRepository.findSlotsForVehicleType(vehicleType);
  if (slots.length === 0) throw parkingErrors.zoneNotConfigured();

  const available = slots
    .map((slot, layoutPosition) => ({ slot, layoutPosition }))
    .filter(({ slot }) => slot.status === 'AVAILABLE');
  if (available.length === 0) throw parkingErrors.zoneFull();

  const usesToday = await parkingRepository.countSessionsSinceBySlot(
    available.map(({ slot }) => slot.id),
    campusDayStart(now),
  );
  const candidates: AllocationCandidate[] = available.map(({ slot, layoutPosition }) => ({
    slotId: slot.id,
    slotCode: slot.code,
    zoneName: slot.zone.name,
    blockName: slot.zone.block.name,
    priority: slot.priority,
    usesToday: usesToday.get(slot.id) ?? 0,
    layoutPosition,
  }));
  return rankCandidates(candidates);
};
