import { z } from 'zod';

import {
  vehicleNumberSchema,
  type ParkingBlockSummary,
  type ParkingSessionView,
} from './operations.js';
import { VEHICLE_TYPES, type VehicleType } from './parking.js';
import { phoneSchema } from './portal.js';
import { VALIDATION_MESSAGES } from './validation.js';

/**
 * Visitor self-service parking. A visitor without an account asks the server for a space; the
 * server picks the block and slot, holds it for a short time and issues a session QR. Security
 * verifies the arrival and only then is a real parking session (and its timer) started.
 */

export const VISITOR_RESERVATION_STATUSES = ['HELD', 'ACTIVATED', 'EXPIRED', 'CANCELLED'] as const;
export type VisitorReservationStatus = (typeof VISITOR_RESERVATION_STATUSES)[number];

/** The only details a visitor gives: the vehicle and a phone number for secure retrieval. */
export const visitorReservationRequestSchema = z.object({
  vehicleNumber: vehicleNumberSchema,
  vehicleType: z.enum(VEHICLE_TYPES, { error: VALIDATION_MESSAGES.selectOption }),
  contactPhone: phoneSchema,
});
export type VisitorReservationRequest = z.input<typeof visitorReservationRequestSchema>;

export interface VisitorReservationView {
  reservationId: string;
  status: VisitorReservationStatus;
  /** When the temporary hold lapses (only meaningful while HELD). */
  expiresAt: string;
  /** Seconds the hold lasts in total, for the countdown. */
  holdSeconds: number;
  vehicleNumber: string;
  vehicleType: VehicleType;
  block: ParkingBlockSummary;
  zone: { code: string; name: string };
  slotCode: string;
  /** Opaque reference encoded in the session QR (`cpvts:session:<reference>`). */
  qrReference: string | null;
  /** The parking session, once Security has activated the arrival. */
  sessionNumber: string | null;
}

/** Returned once, when the reservation is created. The token is the visitor's only key to it. */
export interface VisitorReservationCreated {
  reservation: VisitorReservationView;
  /** Session-scoped token for `GET/DELETE /visitor/reservation`. */
  accessToken: string;
  accessExpiresAt: string;
}

/** Status of the visitor's own reservation, plus a session token once the session is active. */
export interface VisitorReservationStatusResponse {
  reservation: VisitorReservationView;
  session: { accessToken: string; expiresAt: string; sessionNumber: string } | null;
}

/** Security: find a pending arrival by its QR text or by the vehicle number. */
export const arrivalLookupRequestSchema = z
  .object({
    qr: z
      .string()
      .trim()
      .min(1, { error: VALIDATION_MESSAGES.required })
      .max(300, { error: VALIDATION_MESSAGES.tooLong })
      .optional(),
    vehicleNumber: vehicleNumberSchema.optional(),
  })
  .refine((value) => Boolean(value.qr) !== Boolean(value.vehicleNumber), {
    error: VALIDATION_MESSAGES.required,
  });
export type ArrivalLookupRequest = z.input<typeof arrivalLookupRequestSchema>;

export interface ArrivalView {
  reservationId: string;
  status: VisitorReservationStatus;
  vehicleNumber: string;
  vehicleType: VehicleType;
  /** Shown to Security only, to reach the visitor if needed. */
  contactPhone: string;
  block: ParkingBlockSummary;
  zone: { code: string; name: string };
  slotCode: string;
  expiresAt: string;
  createdAt: string;
  sessionNumber: string | null;
}

export interface ArrivalResponse {
  matchedBy: 'ENTRY_QR' | 'VEHICLE_NUMBER';
  arrival: ArrivalView;
}

export interface PendingArrivalsResponse {
  arrivals: ArrivalView[];
}

export interface ActivateArrivalResponse {
  session: ParkingSessionView;
}
