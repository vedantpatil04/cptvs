import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import type { Prisma, VehicleType } from '../../generated/prisma/client.js';

/** Everything needed to present a parking session. */
export const SESSION_INCLUDE = {
  vehicle: true,
  slot: { include: { zone: { include: { block: true } } } },
  receipt: { select: { receiptNumber: true } },
} as const satisfies Prisma.ParkingSessionInclude;

export type SessionWithRelations = Prisma.ParkingSessionGetPayload<{
  include: typeof SESSION_INCLUDE;
}>;

export const RECEIPT_INCLUDE = {
  payment: true,
  session: {
    include: { vehicle: true, slot: { include: { zone: { include: { block: true } } } } },
  },
} as const satisfies Prisma.ReceiptInclude;

export type ReceiptWithRelations = Prisma.ReceiptGetPayload<{ include: typeof RECEIPT_INCLUDE }>;

const ACTIVE_ZONE = { isActive: true, block: { isActive: true } } as const;

export const parkingRepository = {
  /** The vehicle with its registered owner's account state, if any. */
  findVehicle(vehicleNumber: string, db: DbClient = prisma) {
    return db.vehicle.findUnique({
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
  },

  findActiveSessionByVehicleNumber(vehicleNumber: string, db: DbClient = prisma) {
    return db.parkingSession.findFirst({
      where: { status: 'ACTIVE', vehicle: { vehicleNumber } },
      include: SESSION_INCLUDE,
    });
  },

  findSessionByNumber(sessionNumber: string, db: DbClient = prisma) {
    return db.parkingSession.findUnique({ where: { sessionNumber }, include: SESSION_INCLUDE });
  },

  findSessionByEntryReference(entryReference: string, db: DbClient = prisma) {
    return db.parkingSession.findUnique({ where: { entryReference }, include: SESSION_INCLUDE });
  },

  findSlotByCode(code: string, db: DbClient = prisma) {
    return db.parkingSlot.findUnique({ where: { code }, select: { id: true, code: true } });
  },

  findActiveSessionBySlotId(slotId: string, db: DbClient = prisma) {
    return db.parkingSession.findFirst({
      where: { status: 'ACTIVE', slotId },
      include: SESSION_INCLUDE,
    });
  },

  listActiveSessions(db: DbClient = prisma) {
    return db.parkingSession.findMany({
      where: { status: 'ACTIVE' },
      include: SESSION_INCLUDE,
      orderBy: [{ entryAt: 'asc' }, { sessionNumber: 'asc' }],
    });
  },

  /**
   * Every slot of the active zones for a vehicle type, in configured layout
   * order (block → zone → slot). Includes unavailable slots so that layout
   * positions are stable regardless of occupancy.
   */
  findSlotsForVehicleType(vehicleType: VehicleType, db: DbClient = prisma) {
    return db.parkingSlot.findMany({
      where: { zone: { ...ACTIVE_ZONE, vehicleType } },
      include: { zone: { include: { block: true } } },
      orderBy: [
        { zone: { block: { sortOrder: 'asc' } } },
        { zone: { block: { code: 'asc' } } },
        { zone: { sortOrder: 'asc' } },
        { zone: { code: 'asc' } },
        { sortOrder: 'asc' },
        { code: 'asc' },
      ],
    });
  },

  /** Sessions started since `since`, per slot. */
  async countSessionsSinceBySlot(slotIds: string[], since: Date, db: DbClient = prisma) {
    if (slotIds.length === 0) return new Map<string, number>();
    const groups = await db.parkingSession.groupBy({
      by: ['slotId'],
      where: { slotId: { in: slotIds }, entryAt: { gte: since } },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.slotId, group._count._all]));
  },

  /** Active blocks → active zones → slots, with the active session of occupied slots. */
  findMapLayout(db: DbClient = prisma) {
    return db.parkingBlock.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: {
        zones: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
          include: {
            slots: {
              orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
              include: {
                sessions: { where: { status: 'ACTIVE' }, include: { vehicle: true }, take: 1 },
              },
            },
          },
        },
      },
    });
  },

  findPaymentWithSessionNumber(paymentId: string, db: DbClient = prisma) {
    return db.payment.findUnique({
      where: { id: paymentId },
      include: { session: { select: { sessionNumber: true } } },
    });
  },

  findReceiptByNumber(receiptNumber: string, db: DbClient = prisma) {
    return db.receipt.findUnique({ where: { receiptNumber }, include: RECEIPT_INCLUDE });
  },

  findReceiptByVerificationReference(reference: string, db: DbClient = prisma) {
    return db.receipt.findUnique({
      where: { verificationReference: reference },
      include: RECEIPT_INCLUDE,
    });
  },
};
