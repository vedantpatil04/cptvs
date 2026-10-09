import type {
  FeeBreakdown,
  FeeSchedule,
  ParkingBlockSummary,
  ParkingSessionView,
  PaymentView,
  ReceiptView,
} from '@cpvts/shared';

import type { ParkingBlock, Payment } from '../../generated/prisma/client.js';
import { campusHour } from '../../lib/campus-time.js';
import { calculateFee } from '../fees/fee-engine.js';
import type { ReceiptWithRelations, SessionWithRelations } from './parking.repository.js';

export interface LiveContext {
  /** Current campus hour (0–23). */
  currentHour: number;
  /** Configured fee schedule, or null if fees are not configured. */
  schedule: FeeSchedule | null;
}

export const toBlockSummary = (block: ParkingBlock): ParkingBlockSummary => ({
  code: block.code,
  name: block.name,
  coordinates:
    block.latitude !== null && block.longitude !== null
      ? { latitude: block.latitude.toNumber(), longitude: block.longitude.toNumber() }
      : null,
});

/** Live duration in the whole-hour model; never negative. */
export const currentDuration = (entryHour: number, currentHour: number): number =>
  Math.max(0, currentHour - entryHour);

/** The fee breakdown frozen into the session at finalization (written only by the fee engine). */
const storedBreakdown = (value: unknown): FeeBreakdown | null =>
  value === null || value === undefined ? null : (value as FeeBreakdown);

export const toSessionView = (
  session: SessionWithRelations,
  { currentHour, schedule }: LiveContext,
): ParkingSessionView => {
  const isActive = session.status === 'ACTIVE';
  // Once Security has scanned the session at the exit gate the timer is stopped: the live values
  // describe that captured instant, not the moment the view is read.
  const frozenAt = isActive ? session.exitCapturedAt : null;
  const effectiveHour = frozenAt ? campusHour(frozenAt) : currentHour;
  const liveDuration = isActive ? currentDuration(session.entryHour, effectiveHour) : null;

  return {
    sessionNumber: session.sessionNumber,
    status: session.status,
    lifecycle: !isActive ? 'COMPLETED' : session.exitRequestedAt ? 'EXIT_REQUESTED' : 'ACTIVE',
    exitRequestedAt: session.exitRequestedAt?.toISOString() ?? null,
    vehicleNumber: session.vehicle.vehicleNumber,
    vehicleType: session.vehicleType,
    ownerCategory: session.ownerCategory,
    block: toBlockSummary(session.slot.zone.block),
    zone: { code: session.slot.zone.code, name: session.slot.zone.name },
    slotCode: session.slot.code,
    entryHour: session.entryHour,
    entryAt: session.entryAt.toISOString(),
    entryReference: isActive ? session.entryReference : null,
    currentHour: isActive ? effectiveHour : null,
    currentDurationHours: liveDuration,
    estimatedFee:
      isActive && schedule && liveDuration !== null
        ? calculateFee(schedule, session.ownerCategory, session.vehicleType, liveDuration)
        : null,
    exitCapturedAt: frozenAt?.toISOString() ?? null,
    timeAdjusted: session.timeAdjustedAt !== null,
    exitHour: session.exitHour,
    exitAt: session.exitAt?.toISOString() ?? null,
    durationHours: session.durationHours,
    fee: storedBreakdown(session.feeBreakdown),
    receiptNumber: session.receipt?.receiptNumber ?? null,
  };
};

export const toPaymentView = (payment: Payment): PaymentView => ({
  id: payment.id,
  transactionId: payment.transactionId,
  method: payment.method,
  status: payment.status,
  amountPaise: payment.amountPaise,
  exitHour: payment.exitHour,
  isSimulated: payment.isSimulated,
  failureReason: payment.failureReason,
  paidAt: payment.paidAt?.toISOString() ?? null,
  createdAt: payment.createdAt.toISOString(),
});

/** Receipt values come only from the finalized transaction. */
export const toReceiptView = (receipt: ReceiptWithRelations): ReceiptView => {
  const { session, payment } = receipt;
  return {
    receiptNumber: receipt.receiptNumber,
    verificationReference: receipt.verificationReference,
    issuedAt: receipt.issuedAt.toISOString(),
    sessionNumber: session.sessionNumber,
    vehicleNumber: session.vehicle.vehicleNumber,
    vehicleType: session.vehicleType,
    ownerCategory: session.ownerCategory,
    block: toBlockSummary(session.slot.zone.block),
    slotCode: session.slot.code,
    entryHour: session.entryHour,
    exitHour: session.exitHour ?? payment.exitHour,
    durationHours: session.durationHours ?? 0,
    fee: storedBreakdown(session.feeBreakdown) as FeeBreakdown,
    totalPaise: receipt.amountPaise,
    payment: {
      status: payment.status,
      method: payment.method,
      transactionId: payment.transactionId,
      isSimulated: payment.isSimulated,
      paidAt: payment.paidAt?.toISOString() ?? null,
    },
  };
};
