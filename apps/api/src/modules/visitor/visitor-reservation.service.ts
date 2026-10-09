import type {
  VisitorReservationCreated,
  VisitorReservationRequest,
  VisitorReservationStatus,
  VisitorReservationStatusResponse,
  VisitorReservationView,
} from '@cpvts/shared';

import { config } from '../../config/index.js';
import { isUniqueViolation } from '../../db/errors.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError, conflict } from '../../lib/errors.js';
import { newOpaqueReference } from '../../lib/identifiers.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { RequestMeta } from '../auth/auth.types.js';
import { tokenService } from '../auth/token.service.js';
import { allocateWithHold, type SlotHoldStore } from '../parking/allocation.js';
import { loadRankedCandidates } from '../parking/allocation-candidates.js';
import { auditRejection, type ActorContext } from '../parking/operation-context.js';
import { parkingErrors } from '../parking/parking.errors.js';
import { toBlockSummary } from '../parking/parking.mappers.js';
import { parkingRepository } from '../parking/parking.repository.js';
import { slotHoldRepository } from '../parking/slot-hold.repository.js';
import { accountCategoryOf } from '../parking/vehicle-lookup.service.js';

/** A visitor's slot is held while they drive in, longer than a desk allocation. */
const visitorHoldStore: SlotHoldStore = {
  acquire: (slotId) => slotHoldRepository.acquire(slotId, prisma, config.parking.visitorHoldMs),
  release: (slotId, token) => slotHoldRepository.release(slotId, token),
};

export const RESERVATION_INCLUDE = {
  slot: { include: { zone: { include: { block: true } } } },
  session: { select: { sessionNumber: true } },
} as const satisfies Prisma.VisitorReservationInclude;

export type ReservationRow = Prisma.VisitorReservationGetPayload<{
  include: typeof RESERVATION_INCLUDE;
}>;

/** A HELD reservation past its expiry reads as EXPIRED even before the sweeper marks it. */
export const effectiveStatus = (row: {
  status: VisitorReservationStatus;
  expiresAt: Date;
}): VisitorReservationStatus =>
  row.status === 'HELD' && row.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : row.status;

export const toReservationView = (row: ReservationRow): VisitorReservationView => {
  const status = effectiveStatus(row);
  return {
    reservationId: row.id,
    status,
    expiresAt: row.expiresAt.toISOString(),
    holdSeconds: Math.round(config.parking.visitorHoldMs / 1000),
    vehicleNumber: row.vehicleNumber,
    vehicleType: row.vehicleType,
    block: toBlockSummary(row.slot.zone.block),
    zone: { code: row.slot.zone.code, name: row.slot.zone.name },
    slotCode: row.slot.code,
    // The QR is only useful while the space is held or once the session is running.
    qrReference: status === 'HELD' || status === 'ACTIVATED' ? row.reference : null,
    sessionNumber: row.session?.sessionNumber ?? null,
  };
};

const asVisitor = (request: RequestMeta): ActorContext => ({
  actor: null,
  request,
  channel: 'VISITOR',
});

const load = async (reservationId: string): Promise<ReservationRow> => {
  const row = await prisma.visitorReservation.findUnique({
    where: { id: reservationId },
    include: RESERVATION_INCLUDE,
  });
  if (!row) throw parkingErrors.reservationNotFound();
  return row;
};

/**
 * Visitor self-service parking, step one. A visitor with no account gives a vehicle number,
 * a vehicle type and a phone number. The server — never the visitor — picks the block and the
 * slot with the same deterministic allocation as every other entry, HOLDS it for
 * `VISITOR_HOLD_MINUTES` and returns a session QR. Nothing is parked yet: Security verifies
 * the arrival and activates the real session. An abandoned reservation simply expires and the
 * slot returns to the pool.
 *
 * Abuse limits: one open reservation per vehicle (database-enforced), a cap on all open
 * reservations, a per-IP hourly budget, a registered account's vehicle is refused, and the
 * visitor's token reaches this one reservation and nothing else.
 */
export const visitorReservationService = {
  async create(
    input: VisitorReservationRequest & { vehicleNumber: string },
    request: RequestMeta,
  ): Promise<VisitorReservationCreated> {
    const context = asVisitor(request);
    const vehicleNumber = String(input.vehicleNumber);
    const reject = (error: AppError) =>
      auditRejection(error, context, {
        entityType: AUDIT_ENTITY_TYPES.vehicle,
        entityId: vehicleNumber,
        metadata: { vehicleNumber, vehicleType: input.vehicleType },
      });

    await slotHoldRepository.releaseExpired();

    if (await parkingRepository.findActiveSessionByVehicleNumber(vehicleNumber)) {
      throw await reject(parkingErrors.duplicateActiveVehicle());
    }
    const existingVehicle = await parkingRepository.findVehicle(vehicleNumber);
    if (existingVehicle && existingVehicle.vehicleType !== input.vehicleType) {
      throw await reject(parkingErrors.vehicleTypeMismatch());
    }
    // A verified Student / Campus Staff vehicle is billed by its account: use Park My Vehicle.
    if (accountCategoryOf(existingVehicle?.owner ?? null)) {
      throw await reject(parkingErrors.visitorVehicleRegistered());
    }

    const now = new Date();
    if (
      await prisma.visitorReservation.count({
        where: { vehicleNumber, status: 'HELD', expiresAt: { gt: now } },
      })
    ) {
      throw conflict('A parking space is already reserved for this vehicle.');
    }
    const open = await prisma.visitorReservation.count({
      where: { status: 'HELD', expiresAt: { gt: now } },
    });
    if (open >= config.parking.visitorMaxOpenReservations) {
      throw await reject(parkingErrors.reservationsBusy());
    }

    let ranked;
    try {
      ranked = await loadRankedCandidates(input.vehicleType);
    } catch (error) {
      if (error instanceof AppError) throw await reject(error);
      throw error;
    }

    let reservationId: string;
    try {
      const outcome = await allocateWithHold(
        ranked,
        visitorHoldStore,
        async (candidate, token, explanation) => {
          const held = await prisma.parkingSlot.findFirst({
            where: { id: candidate.slotId, status: 'HELD', holdToken: token },
            select: { holdExpiresAt: true },
          });
          if (!held?.holdExpiresAt) return null;
          return withTransaction(async (tx) => {
            const row = await tx.visitorReservation.create({
              data: {
                reference: newOpaqueReference(),
                vehicleNumber,
                vehicleType: input.vehicleType,
                contactPhone: String(input.contactPhone),
                slotId: candidate.slotId,
                holdToken: token,
                allocation: explanation as unknown as Prisma.InputJsonObject,
                expiresAt: held.holdExpiresAt!,
              },
              select: { id: true },
            });
            await auditRepository.record(
              {
                action: AUDIT_ACTIONS.visitorReservationCreated,
                entityType: AUDIT_ENTITY_TYPES.vehicle,
                entityId: vehicleNumber,
                metadata: { slotCode: candidate.slotCode, score: candidate.score, via: 'VISITOR' },
                request,
              },
              tx,
            );
            return row.id;
          });
        },
      );
      reservationId = outcome.result;
    } catch (error) {
      if (isUniqueViolation(error, 'visitor_reservations_one_held_per_vehicle')) {
        throw conflict('A parking space is already reserved for this vehicle.');
      }
      throw error;
    }

    const row = await load(reservationId);
    const { token, expiresAt } = tokenService.issueReservationToken(reservationId);
    return {
      reservation: toReservationView(row),
      accessToken: token,
      accessExpiresAt: expiresAt.toISOString(),
    };
  },

  /**
   * The visitor's own reservation. Once Security has activated the arrival this also returns a
   * normal visitor session token, so the live timer, fee, exit steps and receipt use the
   * existing session-scoped visitor routes.
   */
  async status(reservationId: string): Promise<VisitorReservationStatusResponse> {
    await slotHoldRepository.releaseExpired();
    const row = await load(reservationId);
    let session: VisitorReservationStatusResponse['session'] = null;
    if (row.status === 'ACTIVATED' && row.sessionId && row.session) {
      const { token, expiresAt } = tokenService.issueVisitorToken(row.sessionId);
      session = {
        accessToken: token,
        expiresAt: expiresAt.toISOString(),
        sessionNumber: row.session.sessionNumber,
      };
    }
    return { reservation: toReservationView(row), session };
  },

  /** The visitor changes their mind: the held slot returns to the pool straight away. */
  async cancel(reservationId: string, request: RequestMeta): Promise<VisitorReservationView> {
    await withTransaction(async (tx) => {
      const row = await tx.visitorReservation.findUnique({ where: { id: reservationId } });
      if (!row) throw parkingErrors.reservationNotFound();
      if (row.status === 'ACTIVATED') throw conflict('This parking session has already started.');
      const claimed = await tx.visitorReservation.updateMany({
        where: { id: row.id, status: 'HELD' },
        data: { status: 'CANCELLED' },
      });
      if (claimed.count !== 1) return; // already cancelled or expired: nothing more to do
      await slotHoldRepository.release(row.slotId, row.holdToken, tx);
      await auditRepository.record(
        {
          action: AUDIT_ACTIONS.visitorReservationCancelled,
          entityType: AUDIT_ENTITY_TYPES.vehicle,
          entityId: row.vehicleNumber,
          metadata: { via: 'VISITOR' },
          request,
        },
        tx,
      );
    });
    return toReservationView(await load(reservationId));
  },
};
