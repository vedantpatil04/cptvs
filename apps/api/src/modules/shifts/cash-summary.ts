import type { ShiftCashSummary } from '@cpvts/shared';

import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';

export const emptyCashSummary = (): ShiftCashSummary => ({
  transactions: 0,
  cashTransactions: 0,
  expectedCashPaise: 0,
  digitalTransactions: 0,
  upiPaise: 0,
  cardPaise: 0,
  digitalPaise: 0,
  noChargeTransactions: 0,
  totalPaise: 0,
  openPayments: 0,
});

/**
 * What each shift collected, computed from the payments attributed to it — the single source
 * of the cash a guard must hand over. Only PAID payments count as collected; PENDING and
 * PROCESSING ones are reported as open. Cash and digital (UPI, card) are kept apart. Payments
 * are simulated, so none of this claims real bank settlement.
 */
export const loadCashSummaries = async (
  shiftIds: string[],
  db: DbClient = prisma,
): Promise<Map<string, ShiftCashSummary>> => {
  const summaries = new Map(shiftIds.map((id) => [id, emptyCashSummary()]));
  if (shiftIds.length === 0) return summaries;

  const groups = await db.payment.groupBy({
    by: ['shiftId', 'status', 'method'],
    where: { shiftId: { in: shiftIds } },
    _count: { _all: true },
    _sum: { amountPaise: true },
  });

  const upiCount = new Map<string, number>();
  const cardCount = new Map<string, number>();
  for (const group of groups) {
    const summary = group.shiftId ? summaries.get(group.shiftId) : undefined;
    if (!group.shiftId || !summary) continue;
    const count = group._count._all;
    const amount = group._sum.amountPaise ?? 0;

    if (group.status === 'PENDING' || group.status === 'PROCESSING') {
      summary.openPayments += count;
      continue;
    }
    if (group.status !== 'PAID') continue;

    summary.transactions += count;
    if (group.method === 'CASH') {
      summary.cashTransactions += count;
      summary.expectedCashPaise += amount;
    } else if (group.method === 'UPI') {
      summary.upiPaise += amount;
      upiCount.set(group.shiftId, (upiCount.get(group.shiftId) ?? 0) + count);
    } else if (group.method === 'CARD') {
      summary.cardPaise += amount;
      cardCount.set(group.shiftId, (cardCount.get(group.shiftId) ?? 0) + count);
    } else {
      summary.noChargeTransactions += count;
    }
  }

  for (const [id, summary] of summaries) {
    summary.digitalTransactions = (upiCount.get(id) ?? 0) + (cardCount.get(id) ?? 0);
    summary.digitalPaise = summary.upiPaise + summary.cardPaise;
    summary.totalPaise = summary.expectedCashPaise + summary.digitalPaise;
  }
  return summaries;
};
