import type { CheckInResponse, OwnerCategory, VehicleType } from '@cpvts/shared';

import { isUniqueViolation } from '../../db/errors.js';
import { withTransaction } from '../../db/transaction.js';
import { campusHour } from '../../lib/campus-time.js';
import { AppError } from '../../lib/errors.js';
import { newOpaqueReference, newSessionNumber } from '../../lib/identifiers.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { feeScheduleService } from '../fees/fee-schedule.service.js';
import { notificationService } from '../notifications/notification.service.js';
import { allocateWithHold, type RankedCandidate } from './allocation.js';
import { loadRankedCandidates } from './allocation-candidates.js';
import { auditRejection, type OperationContext } from './operation-context.js';
import { parkingErrors } from './parking.errors.js';
import { toSessionView } from './parking.mappers.js';
import { parkingRepository, SESSION_INCLUDE } from './parking.repository.js';
import { slotHoldRepository, slotHoldStore } from './slot-hold.repository.js';
import { accountCategoryOf } from './vehicle-lookup.service.js';

export interface CheckInInput {
  /** Already normalised and validated (see `checkInRequestSchema`). */
  vehicleNumber: string;
  vehicleType: VehicleType;
  ownerCategory: OwnerCategory;
  entryHour: number;
}

/**
 * Unique indexes that fire when the same vehicle is checked in concurrently:
 * the first-ever registration of the vehicle, or a second active session.
 */
const DUPLICATE_CHECK_IN_CONSTRAINTS = [
  'parking_sessions_one_active_per_vehicle',
  'vehicles_vehicle_number_key',
];

/** Generates a session number not yet in use (collisions are astronomically unlikely). */
export const uniqueSessionNumber = async (
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = newSessionNumber();
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('Could not generate a unique session number');
};

export const checkInService = {
  /**
   * Vehicle check-in (Master Blueprint §9): validate, prevent duplicates,
   * determine the zone, rank available compatible slots, hold the best one,
   * verify it one final time and commit the session — all server-side.
   */
  async checkIn(input: CheckInInput, context: OperationContext): Promise<CheckInResponse> {
    const reject = (error: AppError) =>
      auditRejection(error, context, {
        entityType: AUDIT_ENTITY_TYPES.vehicle,
        entityId: input.vehicleNumber,
        metadata: { vehicleNumber: input.vehicleNumber, vehicleType: input.vehicleType },
      });

    // 1. Duplicate active vehicle and vehicle-type consistency.
    if (await parkingRepository.findActiveSessionByVehicleNumber(input.vehicleNumber)) {
      throw await reject(parkingErrors.duplicateActiveVehicle());
    }
    const existingVehicle = await parkingRepository.findVehicle(input.vehicleNumber);
    if (existingVehicle && existingVehicle.vehicleType !== input.vehicleType) {
      throw await reject(parkingErrors.vehicleTypeMismatch());
    }

    // A vehicle registered to an active, verified Student / Campus Staff account
    // is billed in that account's category, whatever the operator selected.
    const accountCategory = accountCategoryOf(existingVehicle?.owner ?? null);
    const ownerCategory: OwnerCategory = accountCategory ?? input.ownerCategory;

    // 2. Zone identification and 3. candidates: the shared deterministic rules.
    let ranked: RankedCandidate[];
    try {
      ranked = await loadRankedCandidates(input.vehicleType);
    } catch (error) {
      if (error instanceof AppError) throw await reject(error);
      throw error;
    }

    // 4. Hold → final verification → commit, falling back on lost races.
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

          const vehicle = await tx.vehicle.upsert({
            where: { vehicleNumber: input.vehicleNumber },
            create: { vehicleNumber: input.vehicleNumber, vehicleType: input.vehicleType },
            update: {},
          });
          const sessionNumber = await uniqueSessionNumber(
            async (value) =>
              (await tx.parkingSession.count({ where: { sessionNumber: value } })) > 0,
          );
          const session = await tx.parkingSession.create({
            data: {
              sessionNumber,
              entryReference: newOpaqueReference(),
              vehicleId: vehicle.id,
              slotId: candidate.slotId,
              vehicleType: input.vehicleType,
              ownerCategory,
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
                ownerCategory,
                categorySource: accountCategory ? 'ACCOUNT' : 'OPERATOR',
                entryHour: input.entryHour,
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
                candidates: ranked.length,
              },
              request: context.request,
            },
            tx,
          );
          // A vehicle registered to a Student / Campus Staff account: tell its owner.
          if (vehicle.ownerUserId && vehicle.ownerSince && accountCategory) {
            await notificationService.notify(
              vehicle.ownerUserId,
              'PARKING_STARTED',
              {
                sessionNumber: session.sessionNumber,
                slotCode: candidate.slotCode,
                blockName: candidate.blockName,
                vehicleNumber: input.vehicleNumber,
              },
              tx,
            );
          }
          return session;
        }),
      );
    } catch (error) {
      // Another terminal checked in the same vehicle between our check and commit.
      if (DUPLICATE_CHECK_IN_CONSTRAINTS.some((name) => isUniqueViolation(error, name))) {
        throw await reject(parkingErrors.duplicateActiveVehicle());
      }
      throw error;
    }

    const schedule = await feeScheduleService.find();
    return {
      session: toSessionView(outcome.result, { currentHour: campusHour(), schedule }),
      allocation: outcome.explanation,
      categorySource: accountCategory ? 'ACCOUNT' : 'OPERATOR',
    };
  },
};
