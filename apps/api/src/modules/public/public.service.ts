import {
  VEHICLE_TYPES,
  type PublicAvailability,
  type PublicOverviewResponse,
  type PublicParkingLocation,
  type VehicleType as SharedVehicleType,
} from '@cpvts/shared';

import type { VehicleType as DbVehicleType } from '../../generated/prisma/client.js';
import { feeScheduleService } from '../fees/fee-schedule.service.js';
import { publicRepository } from './public.repository.js';

// Compile-time guarantee that the database enum and the shared contract agree.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const vehicleTypesMatch: Equals<DbVehicleType, SharedVehicleType> = true;
void vehicleTypesMatch;

const getAvailability = async (): Promise<PublicAvailability[]> => {
  const counts = await publicRepository.countSlotsByVehicleTypeAndStatus();
  return VEHICLE_TYPES.map((vehicleType) => {
    const forType = counts.filter((entry) => entry.vehicleType === vehicleType);
    return {
      vehicleType,
      totalSlots: forType.reduce((sum, entry) => sum + entry.count, 0),
      availableSlots: forType
        .filter((entry) => entry.status === 'AVAILABLE')
        .reduce((sum, entry) => sum + entry.count, 0),
    };
  });
};

const getLocations = async (): Promise<PublicParkingLocation[]> => {
  const blocks = await publicRepository.findActiveBlocks();
  return blocks.map((block) => ({
    code: block.code,
    name: block.name,
    description: block.description,
    vehicleTypes: [...new Set(block.zones.map((zone) => zone.vehicleType))],
    coordinates:
      block.latitude !== null && block.longitude !== null
        ? { latitude: block.latitude.toNumber(), longitude: block.longitude.toNumber() }
        : null,
  }));
};

export const publicService = {
  getAvailability,

  async getOverview(): Promise<PublicOverviewResponse> {
    const [availability, locations, feeSchedule] = await Promise.all([
      getAvailability(),
      getLocations(),
      feeScheduleService.find(),
    ]);
    return { generatedAt: new Date().toISOString(), availability, locations, feeSchedule };
  },
};
