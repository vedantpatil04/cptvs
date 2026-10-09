import {
  type ReleaseSlotReservationRequest,
  type ReserveSlotRequest,
  type SlotReservationsResponse,
  type SlotReservationView,
  type VipCheckInRequest,
  type VipCheckInResponse,
} from '@cpvts/shared';

import { isUniqueViolation } from '../../db/errors.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { campusHour } from '../../lib/campus-time.js';
import { AppError, conflict } from '../../lib/errors.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { feeScheduleService } from '../fees/fee-schedule.service.js';
import { auditRejection, type OperationContext } from './operation-context.js';
import { parkingErrors } from './parking.errors.js';
import { toBlockSummary, toSessionView } from './parking.mappers.js';
import { SESSION_INCLUDE } from './parking.repository.js';
import { createActiveSession } from './session-factory.js';
import { ACTIVE_ZONE, IN_SERVICE } from './slot-filters.js';
import { accountCategoryOf } from './vehicle-lookup.service.js';

const INCLUDE = {
  slot: {
    include: {
      zone: { include: { block: true } },
      sessions: { where: { status: 'ACTIVE' }, select: { sessionNumber: true }, take: 1 },
    },
  },
} as const satisfies Prisma.SlotReservationInclude;

type Row = Prisma.SlotReservationGetPayload<{ include: typeof INCLUDE }>;

const toView = (row: Row): SlotReservationView => ({
  id: row.id,
  slotCode: row.slot.code,
  block: toBlockSummary(row.slot.zone.block),
  zone: { code: row.slot.zone.code, name: row.slot.zone.name },
  vehicleType: row.slot.zone.vehicleType,
  vehicleNumber: row.vehicleNumber,
  guestName: row.guestName,
  reason: row.reason,
  status: row.status,
  reservedAt: row.reservedAt.toISOString(),
  reservedByName: row.reservedByName,
  releasedAt: row.releasedAt?.toISOString() ?? null,
  releasedByName: row.releasedByName,
  releaseNote: row.releaseNote,
  slotStatus: row.slot.status,
  sessionNumber: row.slot.sessions[0]?.sessionNumber ?? null,
});

const DUPLICATE_SESSION_CONSTRAINTS = [
  'parking_sessions_one_active_per_vehicle',
  'parking_sessions_one_active_per_slot',
];

const errors = {
  notReservable: (reason: string) =>
    new AppError(409, 'SLOT_NOT_RESERVABLE', `This slot cannot be reserved: ${reason}.`),
  notFound: () =>
    new AppError(404, 'VIP_RESERVATION_NOT_FOUND', 'No active reservation was found.'),
  inUse: () =>
    new AppError(
      409,
      'VIP_SLOT_IN_USE',
      'The reserved vehicle is parked in this slot. Check it out before releasing the reservation.',
    ),
  mismatch: () =>
    new AppError(
      409,
      'VIP_VEHICLE_MISMATCH',
      'This vehicle is not the one the slot is reserved for.',
    ),
  confirmationRequired: () =>
    new AppError(
      400,
      'VIP_CONFIRMATION_REQUIRED',
      'Confirm the official guest and the purpose of the reservation before assigning the slot.',
    ),
};

/**
 * VIP / emergency slot reservation, enforced entirely on the server.
 *
 *  - RESERVED is a persistent slot state. Every allocation path (desk check-in, Park Now, visitor
 *    reservations) only ever takes AVAILABLE slots through compare-and-set updates, so a reserved
 *    slot can not be handed out, and public availability counts only AVAILABLE slots.
 *  - Reserving is an atomic AVAILABLE → RESERVED update: an occupied, held, blocked, disabled,
 *    already-reserved or out-of-service slot is refused and nothing existing is disturbed.
 *  - The designated vehicle checks in through the same session factory as every other entry;
 *    checkout releases the slot back to RESERVED (see checkout finalization), and only an
 *    explicit release by Security returns it to AVAILABLE.
 */
export const vipReservationService = {
  async list(includeReleased = false): Promise<SlotReservationsResponse> {
    const rows = await prisma.slotReservation.findMany({
      where: includeReleased ? {} : { status: 'ACTIVE' },
      include: INCLUDE,
      orderBy: [{ status: 'asc' }, { reservedAt: 'desc' }],
      take: 200,
    });
    return { reservations: rows.map(toView) };
  },

  async reserve(
    input: ReserveSlotRequest & { slotCode: string },
    context: OperationContext,
  ): Promise<SlotReservationView> {
    const slotCode = String(input.slotCode);
    const vehicleNumber = input.vehicleNumber ? String(input.vehicleNumber) : null;
    const reject = (error: AppError) =>
      auditRejection(error, context, {
        entityType: AUDIT_ENTITY_TYPES.parkingSlot,
        entityId: slotCode,
        metadata: { action: 'RESERVE' },
      });

    const slot = await prisma.parkingSlot.findUnique({
      where: { code: slotCode },
      include: { zone: { include: { block: true } } },
    });
    if (!slot || slot.archivedAt)
      throw await reject(new AppError(404, 'SLOT_NOT_FOUND', 'Parking slot not found.'));

    // A named vehicle must fit the slot's zone (a car can not hold a two-wheeler slot).
    if (vehicleNumber) {
      const known = await prisma.vehicle.findUnique({ where: { vehicleNumber } });
      if (known && known.vehicleType !== slot.zone.vehicleType) {
        throw await reject(parkingErrors.vehicleTypeMismatch());
      }
    }

    let reservationId: string;
    try {
      reservationId = await withTransaction(async (tx) => {
        // AVAILABLE → RESERVED is the lock: it fails for any other state and for concurrent callers.
        const claimed = await tx.parkingSlot.updateMany({
          where: { id: slot.id, status: 'AVAILABLE', ...IN_SERVICE, zone: ACTIVE_ZONE },
          data: { status: 'RESERVED' },
        });
        if (claimed.count !== 1) {
          const now = await tx.parkingSlot.findUnique({
            where: { id: slot.id },
            select: { status: true, isEnabled: true },
          });
          const why = !now?.isEnabled
            ? 'it is disabled'
            : now.status === 'OCCUPIED'
              ? 'a vehicle is parked in it'
              : now.status === 'HELD'
                ? 'it is being assigned right now'
                : now.status === 'BLOCKED'
                  ? 'it is blocked'
                  : now.status === 'RESERVED'
                    ? 'it is already reserved'
                    : 'it is not in service';
          throw errors.notReservable(why);
        }
        const row = await tx.slotReservation.create({
          data: {
            slotId: slot.id,
            vehicleNumber,
            guestName: String(input.guestName),
            reason: String(input.reason),
            reservedById: context.actor.id,
            reservedByName: context.actor.fullName,
          },
          select: { id: true },
        });
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.slotReserved,
            actorId: context.actor.id,
            entityType: AUDIT_ENTITY_TYPES.parkingSlot,
            entityId: slot.code,
            metadata: {
              reservationId: row.id,
              vehicleNumber,
              guestName: String(input.guestName),
              reason: String(input.reason),
              ...(context.shiftId ? { shiftId: context.shiftId } : {}),
            },
            request: context.request,
          },
          tx,
        );
        return row.id;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'slot_reservations_one_active_per_slot')) {
        throw await reject(errors.notReservable('it is already reserved'));
      }
      if (error instanceof AppError) throw await reject(error);
      throw error;
    }

    return toView(await loadOrThrow(reservationId));
  },

  /** Explicit release by Security: RESERVED → AVAILABLE. Refused while the VIP is parked. */
  async release(
    id: string,
    input: ReleaseSlotReservationRequest,
    context: OperationContext,
  ): Promise<SlotReservationView> {
    try {
      await withTransaction(async (tx) => {
        const row = await tx.slotReservation.findUnique({
          where: { id },
          include: { slot: { select: { id: true, code: true } } },
        });
        if (!row || row.status !== 'ACTIVE') throw errors.notFound();

        const freed = await tx.parkingSlot.updateMany({
          where: { id: row.slotId, status: 'RESERVED' },
          data: { status: 'AVAILABLE' },
        });
        if (freed.count !== 1) throw errors.inUse();

        await tx.slotReservation.update({
          where: { id: row.id },
          data: {
            status: 'RELEASED',
            releasedAt: new Date(),
            releasedById: context.actor.id,
            releasedByName: context.actor.fullName,
            releaseNote: input.note ? String(input.note) : null,
          },
        });
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.slotReservationReleased,
            actorId: context.actor.id,
            entityType: AUDIT_ENTITY_TYPES.parkingSlot,
            entityId: row.slot.code,
            metadata: {
              reservationId: row.id,
              vehicleNumber: row.vehicleNumber,
              ...(input.note ? { note: String(input.note) } : {}),
            },
            request: context.request,
          },
          tx,
        );
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw await auditRejection(error, context, {
          entityType: AUDIT_ENTITY_TYPES.parkingSlot,
          metadata: { action: 'RELEASE', reservationId: id },
        });
      }
      throw error;
    }
    return toView(await loadOrThrow(id));
  },

  /** The designated (or confirmed) VIP arrives: an ordinary secure session in the reserved slot. */
  async checkIn(
    id: string,
    input: VipCheckInRequest & { vehicleNumber: string },
    context: OperationContext,
  ): Promise<VipCheckInResponse> {
    const vehicleNumber = String(input.vehicleNumber);
    const vehicleType = input.vehicleType;
    const ownerCategory = input.ownerCategory ?? 'STAFF';

    let sessionId: string;
    try {
      sessionId = await withTransaction(async (tx) => {
        const row = await tx.slotReservation.findUnique({
          where: { id },
          include: { slot: { include: { zone: { include: { block: true } } } } },
        });
        if (!row || row.status !== 'ACTIVE') throw errors.notFound();

        // Only the vehicle the slot is reserved for may take it.
        if (row.vehicleNumber && row.vehicleNumber !== vehicleNumber) throw errors.mismatch();
        // No vehicle named: Security must confirm the official guest and purpose.
        if (!row.vehicleNumber && !input.confirmOfficialGuest) throw errors.confirmationRequired();
        if (vehicleType !== row.slot.zone.vehicleType) throw parkingErrors.vehicleTypeMismatch();

        if (
          await tx.parkingSession.count({ where: { status: 'ACTIVE', vehicle: { vehicleNumber } } })
        ) {
          throw parkingErrors.duplicateActiveVehicle();
        }
        const existing = await tx.vehicle.findUnique({
          where: { vehicleNumber },
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
        if (existing && existing.vehicleType !== vehicleType)
          throw parkingErrors.vehicleTypeMismatch();
        // A verified account's vehicle is billed by its account, as at the ordinary desk.
        const accountCategory = accountCategoryOf(existing?.owner ?? null);

        // RESERVED → OCCUPIED: fails if the slot is no longer reserved-and-empty.
        const taken = await tx.parkingSlot.updateMany({
          where: { id: row.slotId, status: 'RESERVED' },
          data: { status: 'OCCUPIED' },
        });
        if (taken.count !== 1) throw conflict('The reserved slot is already in use.');

        const vehicle = await tx.vehicle.upsert({
          where: { vehicleNumber },
          create: { vehicleNumber, vehicleType },
          update: {},
        });
        const session = await createActiveSession(tx, {
          vehicle,
          vehicleType,
          slot: { id: row.slotId, code: row.slot.code, blockName: row.slot.zone.block.name },
          ownerCategory: accountCategory ?? ownerCategory,
          categorySource: accountCategory ? 'ACCOUNT' : 'OPERATOR',
          entryHour: campusHour(),
          checkedInById: context.actor.id,
          channel: 'SECURITY',
          allocation: { score: 0, priority: 0, usesToday: 0, layoutPosition: 0, candidates: 1 },
          request: context.request,
        });
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.vipCheckedIn,
            actorId: context.actor.id,
            entityType: AUDIT_ENTITY_TYPES.parkingSession,
            entityId: session.sessionNumber,
            metadata: {
              reservationId: row.id,
              slotCode: row.slot.code,
              vehicleNumber,
              designated: Boolean(row.vehicleNumber),
              guestName: row.guestName,
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
          entityId: vehicleNumber,
        });
      }
      if (error instanceof AppError) {
        throw await auditRejection(error, context, {
          entityType: AUDIT_ENTITY_TYPES.vehicle,
          entityId: vehicleNumber,
          metadata: { action: 'VIP_CHECK_IN', reservationId: id },
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

const loadOrThrow = async (id: string): Promise<Row> => {
  const row = await prisma.slotReservation.findUnique({ where: { id }, include: INCLUDE });
  if (!row) throw errors.notFound();
  return row;
};
