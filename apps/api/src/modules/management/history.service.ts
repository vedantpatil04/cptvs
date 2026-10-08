import type { HistoryFilters, HistoryItem, Page } from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { optionalDateFilter } from './date-range.js';

export const HISTORY_INCLUDE = {
  vehicle: true,
  slot: { include: { zone: { include: { block: true } } } },
  receipt: { include: { payment: true } },
} as const satisfies Prisma.ParkingSessionInclude;

type HistorySession = Prisma.ParkingSessionGetPayload<{ include: typeof HISTORY_INCLUDE }>;

export const historyWhere = (filters: HistoryFilters): Prisma.ParkingSessionWhereInput => {
  const entryAt = optionalDateFilter(filters);
  return {
    ...(filters.vehicleNumber
      ? { vehicle: { vehicleNumber: { contains: filters.vehicleNumber } } }
      : {}),
    ...(filters.slotCode ? { slot: { code: filters.slotCode } } : {}),
    ...(filters.vehicleType ? { vehicleType: filters.vehicleType } : {}),
    ...(filters.ownerCategory ? { ownerCategory: filters.ownerCategory } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(entryAt ? { entryAt } : {}),
  };
};

/** Values come only from the stored sessions and finalized transactions. */
export const toHistoryItem = (session: HistorySession): HistoryItem => ({
  sessionNumber: session.sessionNumber,
  status: session.status,
  vehicleNumber: session.vehicle.vehicleNumber,
  vehicleType: session.vehicleType,
  ownerCategory: session.ownerCategory,
  blockName: session.slot.zone.block.name,
  slotCode: session.slot.code,
  entryHour: session.entryHour,
  exitHour: session.exitHour,
  durationHours: session.durationHours,
  feePaise: session.feeAmountPaise,
  receiptNumber: session.receipt?.receiptNumber ?? null,
  transactionId: session.receipt?.payment.transactionId ?? null,
  paymentStatus: session.receipt?.payment.status ?? null,
  entryAt: session.entryAt.toISOString(),
  exitAt: session.exitAt?.toISOString() ?? null,
});

/** Parking history (Master Blueprint §24): completed and active sessions, newest first. */
export const historyService = {
  async list(filters: HistoryFilters, page: number, pageSize: number): Promise<Page<HistoryItem>> {
    const where = historyWhere(filters);
    const [total, sessions] = await Promise.all([
      prisma.parkingSession.count({ where }),
      prisma.parkingSession.findMany({
        where,
        include: HISTORY_INCLUDE,
        orderBy: [{ entryAt: 'desc' }, { sessionNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: sessions.map(toHistoryItem), page, pageSize, total };
  },
};
