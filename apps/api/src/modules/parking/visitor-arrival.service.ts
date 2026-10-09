import {
  OPAQUE_REFERENCE_PATTERN,
  parseEntryQrPayload,
  type ActivateArrivalResponse,
  type AllocationExplanation,
  type ArrivalLookupRequest,
  type ArrivalResponse,
  type ArrivalView,
  type PendingArrivalsResponse,
} from '@cpvts/shared';

import { isUniqueViolation } from '../../db/errors.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import { campusHour } from '../../lib/campus-time.js';
import { AppError, conflict } from '../../lib/errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { feeScheduleService } from '../fees/fee-schedule.service.js';
import {
  effectiveStatus,
  RESERVATION_INCLUDE,
  toReservationView,
  type ReservationRow,
} from '../visitor/visitor-reservation.service.js';
import { auditRejection, type OperationContext } from './operation-context.js';
import { parkingErrors } from './parking.errors.js';
import { toBlockSummary, toSessionView } from './parking.mappers.js';
import { SESSION_INCLUDE } from './parking.repository.js';
import { createActiveSession } from './session-factory.js';
import { slotHoldRepository } from './slot-hold.repository.js';
import { accountCategoryOf } from './vehicle-lookup.service.js';

const toArrivalView = (row: ReservationRow): ArrivalView => {
  const view = toReservationView(row);
  return {
    reservationId: view.reservationId,
    status: view.status,
    vehicleNumber: view.vehicleNumber,
    vehicleType: view.vehicleType,
    contactPhone: row.contactPhone,
    block: toBlockSummary(row.slot.zone.block),
    zone: view.zone,
    slotCode: view.slotCode,
    expiresAt: view.expiresAt,
    createdAt: row.createdAt.toISOString(),
    sessionNumber: view.sessionNumber,
  };
};

const DUPLICATE_SESSION_CONSTRAINTS = [
  'parking_sessions_one_active_per_vehicle',
  'parking_sessions_one_active_per_slot',
];

/**
 * Security's side of the visitor flow: find the pending arrival (QR, or authorized lookup by
 * vehicle number) and, after verifying the vehicle at the gate, ACTIVATE it. Only here does a
 * visitor's parking session — and its timer — begin. Activation is atomic: the reservation
 * moves HELD → ACTIVATED, the slot HELD → OCCUPIED and the session is created together, so an
 * expired hold, a lost slot or a second activation can never produce a second session.
 */
export const visitorArrivalService = {
  /** Every open (held, unexpired) arrival, oldest first. */
  async pending(): Promise<PendingArrivalsResponse> {
    await slotHoldRepository.releaseExpired();
    const rows = await prisma.visitorReservation.findMany({
      where: { status: 'HELD', expiresAt: { gt: new Date() } },
      include: RESERVATION_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return { arrivals: rows.map(toArrivalView) };
  },

  async find(input: ArrivalLookupRequest, context: OperationContext): Promise<ArrivalResponse> {
    await slotHoldRepository.releaseExpired();
    const viaQr = Boolean(input.qr);

    let row: ReservationRow | null = null;
    if (input.qr) {
      const text = input.qr.trim();
      const reference =
        parseEntryQrPayload(text) ?? (OPAQUE_REFERENCE_PATTERN.test(text) ? text : null);
      row = reference
        ? await prisma.visitorReservation.findUnique({
            where: { reference },
            include: RESERVATION_INCLUDE,
          })
        : null;
    } else if (input.vehicleNumber) {
      row = await prisma.visitorReservation.findFirst({
        where: { vehicleNumber: String(input.vehicleNumber) },
        include: RESERVATION_INCLUDE,
        orderBy: { createdAt: 'desc' },
      });
    }

    const metadata = { source: viaQr ? 'ENTRY_QR' : 'VEHICLE_NUMBER' } as const;
    if (!row) {
      throw await auditRejection(
        viaQr ? parkingErrors.invalidQrReference() : parkingErrors.reservationNotFound(),
        context,
        { metadata },
      );
    }
    if (effectiveStatus(row) === 'EXPIRED' || row.status === 'CANCELLED') {
      throw await auditRejection(parkingErrors.reservationExpired(), context, {
        entityType: AUDIT_ENTITY_TYPES.vehicle,
        entityId: row.vehicleNumber,
        metadata,
      });
    }
    return { matchedBy: viaQr ? 'ENTRY_QR' : 'VEHICLE_NUMBER', arrival: toArrivalView(row) };
  },

  async activate(
    reservationId: string,
    context: OperationContext,
  ): Promise<ActivateArrivalResponse> {
    await slotHoldRepository.releaseExpired();

    let sessionId: string;
    try {
      sessionId = await withTransaction(async (tx) => {
        const row = await tx.visitorReservation.findUnique({
          where: { id: reservationId },
          include: RESERVATION_INCLUDE,
        });
        if (!row) throw parkingErrors.reservationNotFound();
        if (row.status === 'ACTIVATED') throw conflict('This arrival was already activated.');

        // HELD → ACTIVATED is the lock against double activation; an expired hold fails here.
        const claimed = await tx.visitorReservation.updateMany({
          where: { id: row.id, status: 'HELD', expiresAt: { gt: new Date() } },
          data: { status: 'ACTIVATED' },
        });
        if (claimed.count !== 1) throw parkingErrors.reservationExpired();

        const existingVehicle = await tx.vehicle.findUnique({
          where: { vehicleNumber: row.vehicleNumber },
          include: {
            owner: {
              select: {
                isActive: true,
                role: true,
                parkingProfile: { select: { category: true, verificationStatus: true } },
              },
            },
          },
        });
        if (existingVehicle && existingVehicle.vehicleType !== row.vehicleType) {
          throw parkingErrors.vehicleTypeMismatch();
        }
        // The plate was registered to a verified account since the visitor reserved.
        if (accountCategoryOf(existingVehicle?.owner ?? null)) {
          throw parkingErrors.visitorVehicleRegistered();
        }

        // Final availability check: HELD (same token, not expired) → OCCUPIED.
        const confirmed = await slotHoldRepository.confirm(
          row.slotId,
          row.holdToken,
          row.vehicleType,
          tx,
        );
        if (!confirmed) throw parkingErrors.reservationExpired();

        const vehicle = await tx.vehicle.upsert({
          where: { vehicleNumber: row.vehicleNumber },
          create: { vehicleNumber: row.vehicleNumber, vehicleType: row.vehicleType },
          update: {},
        });
        const allocation = row.allocation as unknown as AllocationExplanation;
        const session = await createActiveSession(tx, {
          vehicle,
          vehicleType: row.vehicleType,
          slot: { id: row.slotId, code: row.slot.code, blockName: row.slot.zone.block.name },
          ownerCategory: 'VISITOR',
          categorySource: 'OPERATOR',
          entryHour: campusHour(),
          checkedInById: context.actor.id,
          channel: 'SECURITY',
          allocation: {
            score: allocation.score,
            priority: allocation.factors.priority,
            usesToday: allocation.factors.usesToday,
            layoutPosition: allocation.factors.layoutPosition,
            candidates: allocation.candidatesConsidered,
          },
          // The visitor keeps the QR they already hold: it is now the Parking Session QR.
          entryReference: row.reference,
          request: context.request,
        });
        await tx.visitorReservation.update({
          where: { id: row.id },
          data: { sessionId: session.id },
        });
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.visitorArrivalActivated,
            actorId: context.actor.id,
            entityType: AUDIT_ENTITY_TYPES.parkingSession,
            entityId: session.sessionNumber,
            metadata: {
              reservationId: row.id,
              vehicleNumber: row.vehicleNumber,
              ...(context.shiftId ? { shiftId: context.shiftId } : {}),
            },
            request: context.request,
          },
          tx,
        );
        return session.id;
      });
    } catch (error) {
      if (DUPLICATE_SESSION_CONSTRAINTS.some((name) => isUniqueViolation(error, name))) {
        throw await auditRejection(parkingErrors.duplicateActiveVehicle(), context, {
          entityType: AUDIT_ENTITY_TYPES.vehicle,
        });
      }
      if (error instanceof AppError) {
        throw await auditRejection(error, context, {
          entityType: AUDIT_ENTITY_TYPES.vehicle,
          metadata: { reservationId },
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
    };
  },
};
