import type { OwnerCategory, ParkingUserCategory, VehicleLookupResponse } from '@cpvts/shared';

import { parkingRepository } from './parking.repository.js';

/**
 * The owner category the account behind a vehicle imposes at check-in, or null
 * when the vehicle is unregistered or its account is not an active, verified
 * Student / Campus Staff account. This is the single rule used by both the
 * entry desk lookup and the check-in itself.
 */
export const accountCategoryOf = (
  owner: {
    isActive: boolean;
    role: string;
    parkingProfile: {
      category: ParkingUserCategory;
      verificationStatus: string;
    } | null;
  } | null,
): OwnerCategory | null =>
  owner?.isActive &&
  owner.role === 'PARKING_USER' &&
  owner.parkingProfile?.verificationStatus === 'VERIFIED'
    ? owner.parkingProfile.category
    : null;

export const vehicleLookupService = {
  /**
   * Entry desk helper (Security Staff / Admin): is this plate known, and does a
   * verified account fix its owner category? Reveals nothing about the owner.
   */
  async lookup(vehicleNumber: string): Promise<VehicleLookupResponse> {
    const [vehicle, active] = await Promise.all([
      parkingRepository.findVehicle(vehicleNumber),
      parkingRepository.findActiveSessionByVehicleNumber(vehicleNumber),
    ]);
    return {
      vehicleNumber,
      known: Boolean(vehicle),
      vehicleType: vehicle?.vehicleType ?? null,
      accountCategory: accountCategoryOf(vehicle?.owner ?? null),
      hasActiveSession: Boolean(active),
    };
  },
};
