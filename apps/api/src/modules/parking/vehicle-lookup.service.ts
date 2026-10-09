import {
  parkNowEligibilityOf,
  type OwnerCategory,
  type ParkingUserCategory,
  type VehicleLookupResponse,
  type VerificationStatus,
} from '@cpvts/shared';

import { parkingRepository } from './parking.repository.js';

/**
 * The owner category the account behind a vehicle imposes at check-in, or null
 * when the vehicle is unregistered or its account is not an active, verified
 * Student / Campus Staff account (the same eligibility rule Park Now uses). This is
 * the single rule used by both the entry desk lookup and the check-in itself, and it
 * reads the account's current state, so a category change by Admin applies at once.
 */
export const accountCategoryOf = (
  owner: {
    isActive: boolean;
    role: string;
    parkingProfile: {
      category: ParkingUserCategory;
      verificationStatus: VerificationStatus;
    } | null;
  } | null,
): OwnerCategory | null =>
  owner?.role === 'PARKING_USER' &&
  owner.parkingProfile &&
  parkNowEligibilityOf(owner.parkingProfile.verificationStatus, owner.isActive).eligible
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
