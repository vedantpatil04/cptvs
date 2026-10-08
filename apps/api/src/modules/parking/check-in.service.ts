import type {
  AllocationExplanation,
  CheckInResponse,
  OwnerCategory,
  VehicleType,
} from '@cpvts/shared';

import { config } from '../../config/index.js';
import { isUniqueViolation } from '../../db/errors.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { campusDayStart, campusHour } from '../../lib/campus-time.js';
import type { AppError } from '../../lib/errors.js';
import { newOpaqueReference, newSessionNumber } from '../../lib/identifiers.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { feeScheduleService } from '../fees/fee-schedule.service.js';
import { notificationService } from '../notifications/notification.service.js';
import {
  allocateWithHold,
  buildExplanation,
  rankCandidates,
  scoreCandidate,
  type AllocationCandidate,
  type RankedCandidate,
} from './allocation.js';
import { auditRejection, type OperationContext } from './operation-context.js';
import { parkingErrors } from './parking.errors.js';
import { toSessionView } from './parking.mappers.js';
import { parkingRepository, SESSION_INCLUDE } from './parking.repository.js';
import { slotHoldRepository, slotHoldStore } from './slot-hold.repository.js';

export interface CheckInInput {
  /** Already normalised and validated (see `checkInRequestSchema`). */
  vehicleNumber: string;
  vehicleType: VehicleType;
  ownerCategory: OwnerCategory;
  entryHour: number;
}

/** A self-service "Park now" request: the entry hour and category are the server's, not the client's. */
export interface SelfParkInput {
  userId: string;
  vehicleNumber: string;
  vehicleType: VehicleType;
  /** The account's own category; used only as the billing fallback, the verified account decides. */
  ownerCategory: OwnerCategory;
}

export interface ParkingProposalResult {
  candidate: RankedCandidate;
  holdToken: string;
  expiresAt: Date;
  explanation: AllocationExplanation;
  ownerCategory: OwnerCategory;
  entryHour: number;
  availableSlots: number;
  totalSlots: number;
}

/**
 * Unique indexes that fire when the same vehicle is checked in concurrently:
 * the first-ever registration of the vehicle, or a second active session.
 */
const DUPLICATE_CHECK_IN_CONSTRAINTS = [
  'parking_sessions_one_active_per_vehicle',
  'vehicles_vehicle_number_key',
];

const isDuplicateCheckIn = (error: unknown): boolean =>
  DUPLICATE_CHECK_IN_CONSTRAINTS.some((name) => isUniqueViolation(error, name));

/** Generates a session number not yet in use (collisions are astronomically unlikely). */
const uniqueSessionNumber = async (
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = newSessionNumber();
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('Could not generate a unique session number');
};

const rejecter =
  (vehicleNumber: string, vehicleType: VehicleType, context: OperationContext) =>
  (error: AppError) =>
    auditRejection(error, context, {
      entityType: AUDIT_ENTITY_TYPES.vehicle,
      entityId: vehicleNumber,
      metadata: { vehicleNumber, vehicleType },
    });

/**
 * Step 1 of every check-in: duplicate active vehicle and vehicle-type
 * consistency, then the billing category. A vehicle registered to an active,
 * verified Student / Campus Staff account is billed in that account's category
 * whatever the operator (or the client) said.
 */
const verifyVehicle = async (
  input: { vehicleNumber: string; vehicleType: VehicleType; ownerCategory: OwnerCategory },
  context: OperationContext,
) => {
  const reject = rejecter(input.vehicleNumber, input.vehicleType, context);
  if (await parkingRepository.findActiveSessionByVehicleNumber(input.vehicleNumber)) {
    throw await reject(parkingErrors.duplicateActiveVehicle());
  }
  const existingVehicle = await parkingRepository.findVehicle(input.vehicleNumber);
  if (existingVehicle && existingVehicle.vehicleType !== input.vehicleType) {
    throw await reject(parkingErrors.vehicleTypeMismatch());
  }

  const owner = existingVehicle?.owner;
  const accountCategory =
    owner?.isActive &&
    owner.role === 'PARKING_USER' &&
    owner.parkingProfile?.verificationStatus === 'VERIFIED'
      ? owner.parkingProfile.category
      : null;
  const ownerCategory: OwnerCategory = accountCategory ?? input.ownerCategory;
  return { existingVehicle, accountCategory, ownerCategory, reject };
};

/**
 * Steps 2–3: only in-service slots of active zones for the vehicle type, the
 * AVAILABLE ones as candidates, ranked best-first. Throws when the zone is not
 * configured or full.
 */
const rankAvailableSlots = async (
  vehicleType: VehicleType,
  reject: (error: AppError) => Promise<AppError>,
) => {
  await slotHoldRepository.releaseExpired();
  const slots = await parkingRepository.findSlotsForVehicleType(vehicleType);
  if (slots.length === 0) throw await reject(parkingErrors.zoneNotConfigured());

  const available = slots
    .map((slot, layoutPosition) => ({ slot, layoutPosition }))
    .filter(({ slot }) => slot.status === 'AVAILABLE');
  if (available.length === 0) throw await reject(parkingErrors.zoneFull());

  const usesToday = await parkingRepository.countSessionsSinceBySlot(
    available.map(({ slot }) => slot.id),
    campusDayStart(new Date()),
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
  return { ranked: rankCandidates(candidates), totalSlots: slots.length };
};

interface CreateSessionArgs {
  input: CheckInInput;
  ownerCategory: OwnerCategory;
  accountCategory: OwnerCategory | null;
  candidate: RankedCandidate;
  candidatesConsidered: number;
  context: OperationContext;
  source: 'OPERATOR' | 'SELF_SERVICE';
}

/**
 * The commit step shared by operator check-in and self-service parking: the
 * slot is already OCCUPIED (confirmed by the caller in this transaction);
 * record the vehicle, the session and the audit trail.
 */
const createSession = async (tx: Prisma.TransactionClient, args: CreateSessionArgs) => {
  const { input, candidate, context, source } = args;
  const vehicle = await tx.vehicle.upsert({
    where: { vehicleNumber: input.vehicleNumber },
    create: { vehicleNumber: input.vehicleNumber, vehicleType: input.vehicleType },
    update: {},
  });
  const sessionNumber = await uniqueSessionNumber(
    async (value) => (await tx.parkingSession.count({ where: { sessionNumber: value } })) > 0,
  );
  const session = await tx.parkingSession.create({
    data: {
      sessionNumber,
      entryReference: newOpaqueReference(),
      vehicleId: vehicle.id,
      slotId: candidate.slotId,
      vehicleType: input.vehicleType,
      ownerCategory: args.ownerCategory,
      entryHour: input.entryHour,
      entryAt: new Date(),
      checkedInById: context.actor.id,
    },
    include: SESSION_INCLUDE,
  });

  await auditRepository.record(
    {
      action: AUDIT_ACTIONS.vehicleCheckedIn,
      actorId: context.actor.id,
      entityType: AUDIT_ENTITY_TYPES.parkingSession,
      entityId: session.sessionNumber,
      metadata: {
        vehicleNumber: input.vehicleNumber,
        vehicleType: input.vehicleType,
        ownerCategory: args.ownerCategory,
        categorySource: args.accountCategory ? 'ACCOUNT' : 'OPERATOR',
        entryHour: input.entryHour,
        source,
      },
      request: context.request,
    },
    tx,
  );
  await auditRepository.record(
    {
      action: AUDIT_ACTIONS.slotAssigned,
      actorId: context.actor.id,
      entityType: AUDIT_ENTITY_TYPES.parkingSlot,
      entityId: candidate.slotCode,
      metadata: {
        sessionNumber: session.sessionNumber,
        score: candidate.score,
        priority: candidate.priority,
        usesToday: candidate.usesToday,
        layoutPosition: candidate.layoutPosition,
        candidates: args.candidatesConsidered,
      },
      request: context.request,
    },
    tx,
  );

  // When security checks in a registered owner's vehicle, tell the owner.
  if (
    source === 'OPERATOR' &&
    vehicle.ownerUserId &&
    vehicle.ownerSince &&
    session.entryAt >= vehicle.ownerSince
  ) {
    await notificationService.notify(tx, vehicle.ownerUserId, 'VEHICLE_CHECKED_IN', {
      vehicleNumber: vehicle.vehicleNumber,
      sessionNumber: session.sessionNumber,
      slotCode: session.slot.code,
      blockName: session.slot.zone.block.name,
    });
  }
  return session;
};

export const checkInService = {
  /**
   * Operator vehicle check-in (Master Blueprint §9): validate, prevent
   * duplicates, determine the zone, rank available compatible slots, hold the
   * best one, verify it one final time and commit the session — all server-side.
   */
  async checkIn(input: CheckInInput, context: OperationContext): Promise<CheckInResponse> {
    const { accountCategory, ownerCategory, reject } = await verifyVehicle(input, context);
    const { ranked } = await rankAvailableSlots(input.vehicleType, reject);

    let outcome;
    try {
      outcome = await allocateWithHold(ranked, slotHoldStore, (candidate, token) =>
        withTransaction(async (tx) => {
          const confirmed = await slotHoldRepository.confirm(
            candidate.slotId,
            token,
            input.vehicleType,
            tx,
          );
          if (!confirmed) return null;
          return createSession(tx, {
            input,
            ownerCategory,
            accountCategory,
            candidate,
            candidatesConsidered: ranked.length,
            context,
            source: 'OPERATOR',
          });
        }),
      );
    } catch (error) {
      // Another terminal checked in the same vehicle between our check and commit.
      if (isDuplicateCheckIn(error)) throw await reject(parkingErrors.duplicateActiveVehicle());
      throw error;
    }

    const schedule = await feeScheduleService.find();
    return {
      session: toSessionView(outcome.result, { currentHour: campusHour(), schedule }),
      allocation: outcome.explanation,
      categorySource: accountCategory ? 'ACCOUNT' : 'OPERATOR',
    };
  },

  /**
   * "Park now", step 1. Runs the same validation and the same ranking as an
   * operator check-in, then HOLDS the engine's best slot for the user for a
   * short time so they can confirm. The user never picks a slot, and holds at
   * most one: starting again releases the earlier one. Nothing is recorded as
   * parked until `confirmSelfPark`.
   */
  async proposeSelfPark(
    input: SelfParkInput,
    context: OperationContext,
  ): Promise<ParkingProposalResult> {
    const entryHour = campusHour();
    const check = { ...input, entryHour };
    await slotHoldRepository.releaseHeldBy(input.userId);
    const { ownerCategory, reject } = await verifyVehicle(check, context);
    const { ranked, totalSlots } = await rankAvailableSlots(input.vehicleType, reject);

    let fallbacks = 0;
    for (const candidate of ranked) {
      const holdToken = await slotHoldRepository.acquire(candidate.slotId, {
        holdMs: config.parking.proposalHoldMs,
        userId: input.userId,
      });
      if (!holdToken) {
        fallbacks += 1;
        continue;
      }
      return {
        candidate,
        holdToken,
        expiresAt: new Date(Date.now() + config.parking.proposalHoldMs),
        explanation: buildExplanation(candidate, ranked.length, fallbacks),
        ownerCategory,
        entryHour,
        availableSlots: ranked.length,
        totalSlots,
      };
    }
    throw parkingErrors.allocationFailed();
  },

  /** Gives a held proposal back (the user backed out). Only the holder's token releases it. */
  async cancelSelfPark(userId: string, slotCode: string, holdToken: string): Promise<void> {
    const slot = await parkingRepository.findSlotByCode(slotCode);
    if (!slot) return;
    await prisma.parkingSlot.updateMany({
      where: { id: slot.id, status: 'HELD', holdToken, holdUserId: userId },
      data: { status: 'AVAILABLE', holdToken: null, holdUserId: null, holdExpiresAt: null },
    });
  },

  /**
   * "Park now", step 2: the user confirms the held slot. The hold is verified
   * one final time (same token, same user, not expired, correct zone) in the
   * same transaction that creates the ACTIVE session, so the slot can only
   * ever become occupied by exactly this session.
   */
  async confirmSelfPark(
    input: SelfParkInput & { slotCode: string; holdToken: string },
    context: OperationContext,
  ): Promise<CheckInResponse> {
    const entryHour = campusHour();
    const check: CheckInInput = {
      vehicleNumber: input.vehicleNumber,
      vehicleType: input.vehicleType,
      ownerCategory: input.ownerCategory,
      entryHour,
    };
    const { accountCategory, ownerCategory, reject } = await verifyVehicle(check, context);

    const slot = await prisma.parkingSlot.findUnique({
      where: { code: input.slotCode },
      include: { zone: { include: { block: true } } },
    });
    if (!slot || slot.status !== 'HELD' || slot.holdUserId !== input.userId) {
      throw parkingErrors.parkProposalExpired();
    }

    // Describe the slot exactly as the engine ranked it (for the explanation and the audit trail).
    const slots = await parkingRepository.findSlotsForVehicleType(input.vehicleType);
    const layoutPosition = slots.findIndex((entry) => entry.id === slot.id);
    const usesToday = await parkingRepository.countSessionsSinceBySlot(
      [slot.id],
      campusDayStart(new Date()),
    );
    const base: AllocationCandidate = {
      slotId: slot.id,
      slotCode: slot.code,
      zoneName: slot.zone.name,
      blockName: slot.zone.block.name,
      priority: slot.priority,
      usesToday: usesToday.get(slot.id) ?? 0,
      layoutPosition: Math.max(layoutPosition, 0),
    };
    const candidate: RankedCandidate = { ...base, score: scoreCandidate(base) };
    const availableNow = slots.filter((entry) => entry.status === 'AVAILABLE').length;

    let session;
    try {
      session = await withTransaction(async (tx) => {
        const confirmed = await slotHoldRepository.confirm(
          slot.id,
          input.holdToken,
          input.vehicleType,
          tx,
          input.userId,
        );
        if (!confirmed) throw parkingErrors.parkProposalExpired();
        return createSession(tx, {
          input: check,
          ownerCategory,
          accountCategory,
          candidate,
          candidatesConsidered: availableNow + 1,
          context,
          source: 'SELF_SERVICE',
        });
      });
    } catch (error) {
      // The hold is no use any more: give the slot back rather than wait for it to lapse.
      await slotHoldRepository.release(slot.id, input.holdToken);
      if (isDuplicateCheckIn(error)) throw await reject(parkingErrors.duplicateActiveVehicle());
      throw error;
    }

    const schedule = await feeScheduleService.find();
    return {
      session: toSessionView(session, { currentHour: campusHour(), schedule }),
      allocation: buildExplanation(candidate, availableNow + 1, 0),
      categorySource: accountCategory ? 'ACCOUNT' : 'OPERATOR',
    };
  },
};
