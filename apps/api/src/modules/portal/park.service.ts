import type {
  CheckInResponse,
  OwnerCategory,
  ParkCancelRequest,
  ParkConfirmRequest,
  ParkProposal,
} from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import { checkInService } from '../parking/check-in.service.js';
import type { OperationContext } from '../parking/operation-context.js';
import { toBlockSummary } from '../parking/parking.mappers.js';
import { portalRepository } from './portal.repository.js';

/** The vehicle must be the signed-in user's own; anything else looks like it does not exist. */
const ownVehicle = async (userId: string, vehicleId: string) => {
  const vehicle = await portalRepository.findOwnedVehicle(userId, vehicleId);
  if (!vehicle) throw accountErrors.vehicleNotFound();
  return vehicle;
};

/** The billing category is the verified account's own (the route only admits verified users). */
const accountCategory = (context: OperationContext): OwnerCategory =>
  context.actor.parkingUser?.category ?? 'VISITOR';

/**
 * "Park now" for Students and Campus Staff. The allocation engine alone picks
 * the slot; the user can only accept the proposal or walk away from it.
 */
export const portalParkingService = {
  async propose(vehicleId: string, context: OperationContext): Promise<ParkProposal> {
    const userId = context.actor.id;
    const vehicle = await ownVehicle(userId, vehicleId);
    const result = await checkInService.proposeSelfPark(
      {
        userId,
        vehicleNumber: vehicle.vehicleNumber,
        vehicleType: vehicle.vehicleType,
        ownerCategory: accountCategory(context),
      },
      context,
    );

    const slot = await prisma.parkingSlot.findUniqueOrThrow({
      where: { id: result.candidate.slotId },
      include: { zone: { include: { block: true } } },
    });
    return {
      proposalToken: result.holdToken,
      expiresAt: result.expiresAt.toISOString(),
      vehicle: {
        id: vehicle.id,
        vehicleNumber: vehicle.vehicleNumber,
        vehicleType: vehicle.vehicleType,
        label: vehicle.label,
      },
      slotCode: slot.code,
      blockName: slot.zone.block.name,
      zoneName: slot.zone.name,
      coordinates: toBlockSummary(slot.zone.block).coordinates,
      ownerCategory: result.ownerCategory,
      entryHour: result.entryHour,
      allocation: result.explanation,
      availability: { availableSlots: result.availableSlots, totalSlots: result.totalSlots },
    };
  },

  async confirm(request: ParkConfirmRequest, context: OperationContext): Promise<CheckInResponse> {
    const { vehicleId, slotCode, proposalToken } = request as {
      vehicleId: string;
      slotCode: string;
      proposalToken: string;
    };
    const userId = context.actor.id;
    const vehicle = await ownVehicle(userId, vehicleId);
    return checkInService.confirmSelfPark(
      {
        userId,
        vehicleNumber: vehicle.vehicleNumber,
        vehicleType: vehicle.vehicleType,
        ownerCategory: accountCategory(context),
        slotCode,
        holdToken: proposalToken,
      },
      context,
    );
  },

  async cancel(request: ParkCancelRequest, context: OperationContext): Promise<void> {
    const { slotCode, proposalToken } = request as { slotCode: string; proposalToken: string };
    await checkInService.cancelSelfPark(context.actor.id, slotCode, proposalToken);
  },
};
