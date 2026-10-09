import type { CashHandoverView, ShiftCashSummary, ShiftView } from '@cpvts/shared';

import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { loadCashSummaries } from './cash-summary.js';
import { cashStatusOf, effectiveStatus, flagsOf, isOnDuty } from './shift-policy.js';

/** Everything needed to present a shift. */
export const SHIFT_INCLUDE = {
  staff: { select: { id: true, fullName: true, username: true } },
  handover: {
    include: {
      receivedBy: { select: { id: true, fullName: true } },
      resolvedBy: { select: { id: true, fullName: true } },
    },
  },
} as const satisfies Prisma.SecurityShiftInclude;

export type ShiftRow = Prisma.SecurityShiftGetPayload<{ include: typeof SHIFT_INCLUDE }>;

const toHandoverView = (handover: NonNullable<ShiftRow['handover']>): CashHandoverView => ({
  expectedCashPaise: handover.expectedCashPaise,
  actualCashPaise: handover.actualCashPaise,
  differencePaise: handover.differencePaise,
  cashTransactions: handover.cashTransactions,
  digitalPaise: handover.digitalPaise,
  note: handover.note,
  receivedBy: handover.receivedBy,
  receivedAt: handover.receivedAt.toISOString(),
  resolution:
    handover.resolvedAt && handover.resolvedBy && handover.resolutionNote
      ? {
          note: handover.resolutionNote,
          resolvedBy: handover.resolvedBy,
          resolvedAt: handover.resolvedAt.toISOString(),
        }
      : null,
});

export const toShiftView = (row: ShiftRow, cash: ShiftCashSummary, now: Date): ShiftView => ({
  id: row.id,
  staff: row.staff,
  templateId: row.templateId,
  name: row.shiftName,
  date: row.shiftDate.toISOString().slice(0, 10),
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  gate: row.gate,
  status: effectiveStatus(row, now),
  onDuty: isOnDuty(row, now),
  flags: flagsOf(row),
  checkedInAt: row.checkedInAt?.toISOString() ?? null,
  checkedOutAt: row.checkedOutAt?.toISOString() ?? null,
  closedAt: row.closedAt?.toISOString() ?? null,
  note: row.note,
  cash,
  cashStatus: cashStatusOf(row.status, row.handover),
  handover: row.handover ? toHandoverView(row.handover) : null,
});

/** Views of several shifts with their cash summaries, loaded with one aggregate query. */
export const toShiftViews = async (
  rows: ShiftRow[],
  now = new Date(),
  db: DbClient = prisma,
): Promise<ShiftView[]> => {
  const summaries = await loadCashSummaries(
    rows.map((row) => row.id),
    db,
  );
  return rows.map((row) => toShiftView(row, summaries.get(row.id)!, now));
};

export const loadShiftView = async (
  id: string,
  db: DbClient = prisma,
): Promise<ShiftView | null> => {
  const row = await db.securityShift.findUnique({ where: { id }, include: SHIFT_INCLUDE });
  if (!row) return null;
  return (await toShiftViews([row], new Date(), db))[0] ?? null;
};
