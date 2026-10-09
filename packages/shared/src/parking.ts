import { z } from 'zod';

/** Only Two-Wheeler and Four-Wheeler vehicles are supported (Master Blueprint §4). */
export const VEHICLE_TYPES = ['TWO_WHEELER', 'FOUR_WHEELER'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

/** Slot IDs carry the vehicle type they serve: T-01 for two-wheelers, F-01 for four-wheelers. */
export const SLOT_CODE_PREFIXES: Record<VehicleType, string> = {
  TWO_WHEELER: 'T',
  FOUR_WHEELER: 'F',
};

export const slotCodeMatchesVehicleType = (code: string, vehicleType: VehicleType): boolean =>
  code.startsWith(`${SLOT_CODE_PREFIXES[vehicleType]}-`);

/** Owner categories used for parking sessions and fees (Master Blueprint §9). */
export const OWNER_CATEGORIES = ['STAFF', 'STUDENT', 'VISITOR'] as const;
export type OwnerCategory = (typeof OWNER_CATEGORIES)[number];

/**
 * One fee rule for an owner category and vehicle type. Amounts are integer
 * paise. This describes the rules; it does not calculate any fee.
 */
export const feeRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('FREE') }),
  z.object({
    type: z.literal('HOURLY'),
    hourlyRatePaise: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('FREE_HOURS_THEN_HOURLY'),
    freeHours: z.number().int().positive(),
    hourlyRatePaise: z.number().int().positive(),
  }),
]);
export type FeeRule = z.infer<typeof feeRuleSchema>;

const rulesByVehicleType = z.object({
  TWO_WHEELER: feeRuleSchema,
  FOUR_WHEELER: feeRuleSchema,
});

/** The configured fee schedule: one rule for every owner category × vehicle type. */
export const feeScheduleSchema = z.object({
  currency: z.literal('INR'),
  rules: z.object({
    STAFF: rulesByVehicleType,
    STUDENT: rulesByVehicleType,
    VISITOR: rulesByVehicleType,
  }),
});
export type FeeSchedule = z.infer<typeof feeScheduleSchema>;

// ---------------------------------------------------------------------------
// Public (unauthenticated) overview. Aggregate, non-identifying data only:
// never vehicle numbers, slot assignments, sessions, payments or revenue.
// ---------------------------------------------------------------------------

export interface PublicAvailability {
  vehicleType: VehicleType;
  /** Slots in active zones for this vehicle type. */
  totalSlots: number;
  /** Of those, slots currently free to park in. */
  availableSlots: number;
}

export interface PublicParkingLocation {
  code: string;
  name: string;
  description: string | null;
  /** Vehicle types accepted by the block's active zones. */
  vehicleTypes: VehicleType[];
  /** Null until real coordinates have been collected for the block. */
  coordinates: { latitude: number; longitude: number } | null;
}

/** Free and total spaces of one block for one vehicle category (public landing page). */
export interface PublicBlockAvailability {
  blockCode: string;
  blockName: string;
  vehicleType: VehicleType;
  totalSlots: number;
  availableSlots: number;
}

export interface PublicOverviewResponse {
  generatedAt: string;
  /** Always one entry per vehicle type, in `VEHICLE_TYPES` order. */
  availability: PublicAvailability[];
  locations: PublicParkingLocation[];
  /** Live free/total spaces per block and vehicle category. */
  blockAvailability: PublicBlockAvailability[];
  /** Null when no valid fee schedule has been configured. */
  feeSchedule: FeeSchedule | null;
}
