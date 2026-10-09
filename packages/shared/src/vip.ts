import { z } from 'zod';

import {
  slotCodeSchema,
  vehicleNumberSchema,
  type ParkingBlockSummary,
  type ParkingSessionView,
  type SlotStatus,
} from './operations.js';
import { VEHICLE_TYPES, type VehicleType } from './parking.js';
import { VALIDATION_MESSAGES } from './validation.js';

/**
 * VIP / emergency slot reservation. Authorized Security Staff keep one specific slot for an
 * official guest or an emergency. A reserved slot is never handed out by any automatic allocation
 * and is not counted as free; the designated vehicle uses it through the normal secure session
 * flow, and the slot stays reserved after checkout until Security explicitly releases it.
 */

const optionalVehicleNumber = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  vehicleNumberSchema.optional(),
);

const text = (max: number, min = 2) =>
  z
    .string({ error: VALIDATION_MESSAGES.required })
    .trim()
    .min(min, { error: VALIDATION_MESSAGES.required })
    .max(max, { error: VALIDATION_MESSAGES.tooLong });

export const reserveSlotRequestSchema = z.object({
  slotCode: slotCodeSchema,
  /** The designated vehicle, where known. Without it Security confirms the guest at arrival. */
  vehicleNumber: optionalVehicleNumber,
  /** Guest name, or a short purpose / reference. */
  guestName: text(120),
  /** Why the slot is reserved (especially for an emergency). */
  reason: text(300, 3),
});
export type ReserveSlotRequest = z.input<typeof reserveSlotRequestSchema>;

export const releaseSlotReservationRequestSchema = z.object({
  note: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(300, { error: VALIDATION_MESSAGES.tooLong }).optional(),
  ),
});
export type ReleaseSlotReservationRequest = z.input<typeof releaseSlotReservationRequestSchema>;

/** Official guests are free by default (Campus Staff rule); Security may bill them as a Visitor. */
export const VIP_OWNER_CATEGORIES = ['STAFF', 'VISITOR'] as const;

export const vipCheckInRequestSchema = z.object({
  vehicleNumber: vehicleNumberSchema,
  vehicleType: z.enum(VEHICLE_TYPES, { error: VALIDATION_MESSAGES.selectOption }),
  ownerCategory: z.enum(VIP_OWNER_CATEGORIES).default('STAFF'),
  /** Required when the reservation names no vehicle: Security confirms the official guest. */
  confirmOfficialGuest: z.boolean().default(false),
});
export type VipCheckInRequest = z.input<typeof vipCheckInRequestSchema>;

export const SLOT_RESERVATION_STATUSES = ['ACTIVE', 'RELEASED'] as const;
export type SlotReservationStatus = (typeof SLOT_RESERVATION_STATUSES)[number];

export interface SlotReservationView {
  id: string;
  slotCode: string;
  block: ParkingBlockSummary;
  zone: { code: string; name: string };
  /** Vehicle type the slot's zone accepts. */
  vehicleType: VehicleType;
  vehicleNumber: string | null;
  guestName: string;
  reason: string;
  status: SlotReservationStatus;
  reservedAt: string;
  reservedByName: string;
  releasedAt: string | null;
  releasedByName: string | null;
  releaseNote: string | null;
  /** Live state of the slot: RESERVED while empty, OCCUPIED while the VIP is parked. */
  slotStatus: SlotStatus;
  /** The VIP's active parking session, while parked. */
  sessionNumber: string | null;
}

export interface SlotReservationsResponse {
  reservations: SlotReservationView[];
}

export interface VipCheckInResponse {
  session: ParkingSessionView;
}
