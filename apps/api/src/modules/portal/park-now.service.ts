import type {
  AllocationExplanation,
  CurrentParkNowOfferResponse,
  ParkNowConfirmation,
  ParkNowOffer,
} from '@cpvts/shared';

import { config } from '../../config/index.js';
import type { DbClient } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { campusHour } from '../../lib/campus-time.js';
import { AppError, conflict } from '../../lib/errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { feeScheduleService } from '../fees/fee-schedule.service.js';
import { allocateWithHold, type SlotHoldStore } from '../parking/allocation.js';
import { loadRankedCandidates } from '../parking/allocation-candidates.js';
import { auditRejection, type OperationContext } from '../parking/operation-context.js';
import { parkingErrors } from '../parking/parking.errors.js';
import { toBlockSummary, toSessionView } from '../parking/parking.mappers.js';
import { parkingRepository, SESSION_INCLUDE } from '../parking/parking.repository.js';
import { createActiveSession } from '../parking/session-factory.js';
import { slotHoldRepository } from '../parking/slot-hold.repository.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import { parkNowErrors } from './park-now.errors.js';
import { accountCategory } from './portal-access.js';

/** Park Now holds the slot for longer than a desk allocation: the user reads and confirms. */
const parkNowHoldStore: SlotHoldStore = {
  acquire: (slotId) => slotHoldRepository.acquire(slotId, prisma, config.parking.parkNowHoldMs),
  release: (slotId, token) => slotHoldRepository.release(slotId, token),
};

const OFFER_INCLUDE = {
  vehicle: { select: { id: true, vehicleNumber: true, vehicleType: true, label: true } },
  slot: { include: { zone: { include: { block: true } } } },
} as const satisfies Prisma.ParkNowOfferInclude;

type OfferRow = Prisma.ParkNowOfferGetPayload<{ include: typeof OFFER_INCLUDE }>;

const toOfferView = (offer: OfferRow, category: ParkNowOffer['ownerCategory']): ParkNowOffer => ({
  offerId: offer.id,
  expiresAt: offer.expiresAt.toISOString(),
  vehicle: offer.vehicle,
  ownerCategory: category,
  block: toBlockSummary(offer.slot.zone.block),
  allocation: offer.allocation as unknown as AllocationExplanation,
});

const DUPLICATE_SESSION_CONSTRAINTS = [
  'parking_sessions_one_active_per_vehicle',
  'parking_sessions_one_active_per_slot',
];

/**
 * Closes the user's open offer (if any) and returns its slot to the pool.
 * Used when the user starts over, cancels, or is deactivated.
 */
export const cancelOpenOffers = async (
  userId: string,
  status: 'CANCELLED' | 'EXPIRED',
  db: DbClient,
): Promise<number> => {
  const open = await db.parkNowOffer.findMany({ where: { userId, status: 'OFFERED' } });
  for (const offer of open) {
    await db.parkNowOffer.update({ where: { id: offer.id }, data: { status } });
    await slotHoldRepository.release(offer.slotId, offer.holdToken, db);
  }
  return open.length;
};

/**
 * Closes any open offer for one vehicle and returns its slot to the pool (used when the
 * vehicle is removed from the account).
 */
export const cancelOffersForVehicle = async (vehicleId: string, db: DbClient): Promise<number> => {
  const open = await db.parkNowOffer.findMany({ where: { vehicleId, status: 'OFFERED' } });
  for (const offer of open) {
    await db.parkNowOffer.update({ where: { id: offer.id }, data: { status: 'CANCELLED' } });
    await slotHoldRepository.release(offer.slotId, offer.holdToken, db);
  }
  return open.length;
};

/**
 * Student / Campus Staff "Park Now" (no advance reservation):
 *
 *   start    → validate ownership and account, run the same deterministic
 *              allocation engine as the security desk, HOLD the chosen slot
 *   confirm  → final availability check, HELD → OCCUPIED, create the ACTIVE session
 *   cancel   → HELD → AVAILABLE
 *
 * The user never picks a slot. Everything — the category, the slot, the entry
 * hour and the hold's lifetime — is decided and verified on the server. An
 * unconfirmed offer lapses by itself.
 */
export const parkNowService = {
  async start(vehicleId: string, context: OperationContext): Promise<ParkNowOffer> {
    const user = context.actor;
    const category = accountCategory(user);

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, ownerUserId: user.id },
    });
    if (!vehicle) throw accountErrors.vehicleNotFound();

    const reject = (error: AppError) =>
      auditRejection(error, context, {
        entityType: AUDIT_ENTITY_TYPES.vehicle,
        entityId: vehicle.vehicleNumber,
        metadata: { vehicleNumber: vehicle.vehicleNumber },
      });

    if (await parkingRepository.findActiveSessionByVehicleNumber(vehicle.vehicleNumber)) {
      throw await reject(parkingErrors.duplicateActiveVehicle());
    }

    // Starting over replaces the previous offer, so one user never holds two slots.
    await cancelOpenOffers(user.id, 'CANCELLED', prisma);

    let ranked;
    try {
      ranked = await loadRankedCandidates(vehicle.vehicleType);
    } catch (error) {
      if (error instanceof AppError) throw await reject(error);
      throw error;
    }

    let offerId: string;
    try {
      const outcome = await allocateWithHold(
        ranked,
        parkNowHoldStore,
        async (candidate, token, explanation) => {
          const held = await prisma.parkingSlot.findFirst({
            where: { id: candidate.slotId, status: 'HELD', holdToken: token },
            select: { holdExpiresAt: true },
          });
          if (!held?.holdExpiresAt) return null;
          return withTransaction(async (tx) => {
            const offer = await tx.parkNowOffer.create({
              data: {
                userId: user.id,
                vehicleId: vehicle.id,
                slotId: candidate.slotId,
                holdToken: token,
                allocation: explanation as unknown as Prisma.InputJsonObject,
                expiresAt: held.holdExpiresAt!,
              },
              select: { id: true },
            });
            await auditRepository.record(
              {
                action: AUDIT_ACTIONS.parkNowOffered,
                actorId: user.id,
                entityType: AUDIT_ENTITY_TYPES.parkNowOffer,
                entityId: offer.id,
                metadata: {
                  vehicleNumber: vehicle.vehicleNumber,
                  slotCode: candidate.slotCode,
                  score: candidate.score,
                },
                request: context.request,
              },
              tx,
            );
            return offer.id;
          });
        },
      );
      offerId = outcome.result;
    } catch (error) {
      if (isUniqueViolation(error, 'park_now_offers_one_open_per_user')) {
        throw conflict('A parking offer is already being created for your account.');
      }
      throw error;
    }

    const offer = await prisma.parkNowOffer.findUniqueOrThrow({
      where: { id: offerId },
      include: OFFER_INCLUDE,
    });
    return toOfferView(offer, category);
  },

  /** The user's open, unexpired offer, so a reloaded page can resume it. */
  async current(context: OperationContext): Promise<CurrentParkNowOfferResponse> {
    const category = accountCategory(context.actor);
    await slotHoldRepository.releaseExpired();
    const offer = await prisma.parkNowOffer.findFirst({
      where: { userId: context.actor.id, status: 'OFFERED', expiresAt: { gt: new Date() } },
      include: OFFER_INCLUDE,
    });
    return { offer: offer ? toOfferView(offer, category) : null };
  },

  async confirm(offerId: string, context: OperationContext): Promise<ParkNowConfirmation> {
    const user = context.actor;
    const category = accountCategory(user);

    // Lapse any stale hold first, so an expired offer is reported as expired.
    await slotHoldRepository.releaseExpired();
    const existing = await prisma.parkNowOffer.findFirst({
      where: { id: offerId, userId: user.id },
      include: OFFER_INCLUDE,
    });
    if (!existing) throw parkNowErrors.offerNotFound();
    if (existing.status === 'EXPIRED') throw parkNowErrors.offerExpired();
    if (existing.status !== 'OFFERED') throw parkNowErrors.offerNotFound();

    let sessionId: string;
    try {
      sessionId = await withTransaction(async (tx) => {
        // OFFERED → CONFIRMED is the lock against double confirmation.
        const claimed = await tx.parkNowOffer.updateMany({
          where: {
            id: existing.id,
            userId: user.id,
            status: 'OFFERED',
            expiresAt: { gt: new Date() },
          },
          data: { status: 'CONFIRMED' },
        });
        if (claimed.count !== 1) throw parkNowErrors.offerExpired();

        // The vehicle must still be this user's.
        const vehicle = await tx.vehicle.findFirst({
          where: { id: existing.vehicleId, ownerUserId: user.id },
        });
        if (!vehicle) throw accountErrors.vehicleNotFound();

        // Final availability check: HELD (same token, not expired) → OCCUPIED.
        const confirmed = await slotHoldRepository.confirm(
          existing.slotId,
          existing.holdToken,
          vehicle.vehicleType,
          tx,
        );
        if (!confirmed) throw parkNowErrors.offerExpired();

        // The same session factory the security desk uses: one session model for both entries.
        const allocation = existing.allocation as unknown as AllocationExplanation;
        const session = await createActiveSession(tx, {
          vehicle,
          vehicleType: vehicle.vehicleType,
          slot: {
            id: existing.slotId,
            code: existing.slot.code,
            blockName: existing.slot.zone.block.name,
          },
          ownerCategory: category,
          categorySource: 'ACCOUNT',
          entryHour: campusHour(),
          checkedInById: user.id,
          channel: 'SELF_SERVICE',
          allocation: {
            score: allocation.score,
            priority: allocation.factors.priority,
            usesToday: allocation.factors.usesToday,
            layoutPosition: allocation.factors.layoutPosition,
            candidates: allocation.candidatesConsidered,
          },
          offerId: existing.id,
          request: context.request,
        });
        return session.id;
      });
    } catch (error) {
      if (DUPLICATE_SESSION_CONSTRAINTS.some((name) => isUniqueViolation(error, name))) {
        throw await auditRejection(parkingErrors.duplicateActiveVehicle(), context, {
          entityType: AUDIT_ENTITY_TYPES.parkNowOffer,
          entityId: offerId,
        });
      }
      throw error;
    }

    const session = await prisma.parkingSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: SESSION_INCLUDE,
    });
    return {
      session: toSessionView(session, {
        currentHour: campusHour(),
        schedule: await feeScheduleService.find(),
      }),
      allocation: existing.allocation as unknown as AllocationExplanation,
    };
  },

  /** The user changes their mind: HELD → AVAILABLE straight away. */
  async cancel(offerId: string, context: OperationContext): Promise<void> {
    await withTransaction(async (tx) => {
      const offer = await tx.parkNowOffer.findFirst({
        where: { id: offerId, userId: context.actor.id, status: 'OFFERED' },
      });
      if (!offer) throw parkNowErrors.offerNotFound();
      await tx.parkNowOffer.update({ where: { id: offer.id }, data: { status: 'CANCELLED' } });
      await slotHoldRepository.release(offer.slotId, offer.holdToken, tx);
      await auditRepository.record(
        {
          action: AUDIT_ACTIONS.parkNowCancelled,
          actorId: context.actor.id,
          entityType: AUDIT_ENTITY_TYPES.parkNowOffer,
          entityId: offer.id,
          request: context.request,
        },
        tx,
      );
    });
  },
};
