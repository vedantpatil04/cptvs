import type {
  CashHandoverRequest,
  CashSummaryResponse,
  ResolveDiscrepancyRequest,
  ShiftTransactionView,
  ShiftView,
  cashSummaryQuerySchema,
} from '@cpvts/shared';
import type { z } from 'zod';

import { isUniqueViolation } from '../../db/errors.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { resolveRange } from '../management/date-range.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { notificationService } from '../notifications/notification.service.js';
import type { OperationContext } from '../parking/operation-context.js';
import { loadCashSummaries } from './cash-summary.js';
import { shiftErrors } from './shift.errors.js';
import { loadShiftView, SHIFT_INCLUDE, toShiftViews } from './shift-views.js';

type OverviewQuery = z.output<typeof cashSummaryQuerySchema>;

/** Campus dates are stored as DATE columns: midnight UTC of the calendar date. */
const dateOnly = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

/**
 * Cash accountability. Every PAID cash payment of a shift adds to the cash that Security
 * Staff member must hand over; at the end of the shift an administrator (the cash
 * custodian) counts what is handed over, and the system compares it with what it expects:
 *
 *   expected 420, actual 420  →  difference 0   → handover recorded, shift CLOSED
 *   expected 420, actual 400  →  difference −20 → a reason is required, the shift stays
 *                                 CHECKED_OUT (not financially closed) until an administrator
 *                                 reviews the difference.
 *
 * Digital collections (UPI, card) are reported beside the cash and never mixed into it.
 * Payments are simulated; nothing here claims real bank settlement.
 */
export const cashService = {
  /** The finalized payments of a shift, for counting the cash drawer against the system. */
  async transactions(shiftId: string): Promise<ShiftTransactionView[]> {
    const exists = await prisma.securityShift.count({ where: { id: shiftId } });
    if (!exists) throw shiftErrors.notFound();
    const payments = await prisma.payment.findMany({
      where: { shiftId, status: 'PAID' },
      include: {
        session: { select: { sessionNumber: true, vehicle: { select: { vehicleNumber: true } } } },
        receipt: { select: { receiptNumber: true } },
      },
      orderBy: [{ paidAt: 'asc' }, { transactionId: 'asc' }],
    });
    return payments.map((payment) => ({
      transactionId: payment.transactionId,
      method: payment.method,
      amountPaise: payment.amountPaise,
      paidAt: (payment.paidAt ?? payment.createdAt).toISOString(),
      sessionNumber: payment.session.sessionNumber,
      vehicleNumber: payment.session.vehicle.vehicleNumber,
      receiptNumber: payment.receipt?.receiptNumber ?? null,
    }));
  },

  /**
   * The administrator records what the guard handed over. The expected figure is computed
   * here, from the payments — never taken from the request — and the shift must have been
   * checked out with no payment left open.
   */
  async recordHandover(
    shiftId: string,
    input: CashHandoverRequest & { note?: string },
    context: OperationContext,
  ): Promise<ShiftView> {
    try {
      await withTransaction(async (tx) => {
        const shift = await tx.securityShift.findUnique({
          where: { id: shiftId },
          include: { handover: { select: { id: true } }, staff: { select: { fullName: true } } },
        });
        if (!shift) throw shiftErrors.notFound();
        if (shift.handover) throw shiftErrors.handoverAlreadyRecorded();
        if (shift.status !== 'CHECKED_OUT') {
          throw shiftErrors.invalidState(
            'Cash can be received once the guard has checked out of the shift.',
          );
        }

        const summary = (await loadCashSummaries([shiftId], tx)).get(shiftId)!;
        if (summary.openPayments > 0) throw shiftErrors.hasOpenPayments();

        const expected = summary.expectedCashPaise;
        const difference = input.actualCashPaise - expected;
        const note = input.note?.trim() || undefined;
        if (difference !== 0 && !note) throw shiftErrors.cashNoteRequired();

        const now = new Date();
        await tx.cashHandover.create({
          data: {
            shiftId,
            expectedCashPaise: expected,
            actualCashPaise: input.actualCashPaise,
            differencePaise: difference,
            cashTransactions: summary.cashTransactions,
            digitalPaise: summary.digitalPaise,
            note: note ?? null,
            receivedById: context.actor.id,
            receivedAt: now,
          },
        });
        // Only a matching handover closes the shift; a difference waits for review.
        if (difference === 0) {
          const { count } = await tx.securityShift.updateMany({
            where: { id: shiftId, status: 'CHECKED_OUT' },
            data: { status: 'CLOSED', closedAt: now },
          });
          if (count !== 1) throw shiftErrors.invalidState();
        }
        await auditRepository.record(
          {
            action: AUDIT_ACTIONS.cashHandoverRecorded,
            actorId: context.actor.id,
            entityType: AUDIT_ENTITY_TYPES.securityShift,
            entityId: shiftId,
            metadata: {
              staffId: shift.staffId,
              expectedCashPaise: expected,
              actualCashPaise: input.actualCashPaise,
              differencePaise: difference,
              cashTransactions: summary.cashTransactions,
              closed: difference === 0,
            },
            request: context.request,
          },
          tx,
        );
        if (difference !== 0) {
          await notificationService.notifyAdmins(
            'CASH_DISCREPANCY',
            {
              staffName: shift.staff.fullName,
              shiftName: shift.shiftName,
              shiftId,
              date: shift.shiftDate.toISOString().slice(0, 10),
              amountPaise: expected,
              differencePaise: difference,
            },
            tx,
            context.actor.id,
          );
        }
      });
    } catch (error) {
      if (isUniqueViolation(error, 'cash_handovers_shift_id_key')) {
        throw shiftErrors.handoverAlreadyRecorded();
      }
      throw error;
    }
    return (await loadShiftView(shiftId))!;
  },

  /** An administrator reviews a cash difference; only then does the shift count as closed. */
  async resolveDiscrepancy(
    shiftId: string,
    input: ResolveDiscrepancyRequest,
    context: OperationContext,
  ): Promise<ShiftView> {
    await withTransaction(async (tx) => {
      const shift = await tx.securityShift.findUnique({ where: { id: shiftId } });
      if (!shift) throw shiftErrors.notFound();
      const handover = await tx.cashHandover.findUnique({ where: { shiftId } });
      if (!handover) throw shiftErrors.handoverNotFound();
      if (handover.differencePaise === 0 || handover.resolvedAt) {
        throw shiftErrors.discrepancyNotOpen();
      }

      const now = new Date();
      const resolved = await tx.cashHandover.updateMany({
        where: { id: handover.id, resolvedAt: null },
        data: {
          resolutionNote: input.note.trim(),
          resolvedById: context.actor.id,
          resolvedAt: now,
        },
      });
      if (resolved.count !== 1) throw shiftErrors.discrepancyNotOpen();
      const closed = await tx.securityShift.updateMany({
        where: { id: shiftId, status: 'CHECKED_OUT' },
        data: { status: 'CLOSED', closedAt: now },
      });
      if (closed.count !== 1) throw shiftErrors.invalidState();
      await auditRepository.record(
        {
          action: AUDIT_ACTIONS.cashDiscrepancyResolved,
          actorId: context.actor.id,
          entityType: AUDIT_ENTITY_TYPES.securityShift,
          entityId: shiftId,
          metadata: { differencePaise: handover.differencePaise, note: input.note.trim() },
          request: context.request,
        },
        tx,
      );
    });
    return (await loadShiftView(shiftId))!;
  },

  /** Handovers that did not match and have not been reviewed — what an administrator must still look at. */
  async discrepancies(): Promise<ShiftView[]> {
    const rows = await prisma.securityShift.findMany({
      where: { handover: { is: { differencePaise: { not: 0 }, resolvedAt: null } } },
      include: SHIFT_INCLUDE,
      orderBy: [{ shiftDate: 'asc' }, { startsAt: 'asc' }],
    });
    return toShiftViews(rows);
  },

  /** Cash and digital collections over a date range, and what is still outstanding. */
  async overview(query: OverviewQuery): Promise<CashSummaryResponse> {
    const range = resolveRange(query);
    const inRange: Prisma.SecurityShiftWhereInput = {
      shiftDate: { gte: dateOnly(range.from), lte: dateOnly(range.to) },
    };
    const securityCash = (role: 'SECURITY_STAFF' | 'ADMIN') =>
      prisma.payment.aggregate({
        where: {
          status: 'PAID',
          method: 'CASH',
          shiftId: null,
          paidAt: { gte: range.start, lt: range.end },
          processedBy: { is: { role } },
        },
        _count: { _all: true },
        _sum: { amountPaise: true },
      });

    const [shiftRows, awaiting, open, unattributed, administrator] = await Promise.all([
      prisma.securityShift.findMany({ where: inRange, include: SHIFT_INCLUDE }),
      prisma.securityShift.findMany({
        where: { status: 'CHECKED_OUT', handover: { is: null } },
        include: SHIFT_INCLUDE,
        orderBy: [{ shiftDate: 'asc' }, { startsAt: 'asc' }],
      }),
      cashService.discrepancies(),
      securityCash('SECURITY_STAFF'),
      securityCash('ADMIN'),
    ]);

    const views = await toShiftViews(shiftRows);
    return {
      from: range.from,
      to: range.to,
      totals: {
        expectedCashPaise: views.reduce((sum, view) => sum + view.cash.expectedCashPaise, 0),
        receivedCashPaise: views.reduce(
          (sum, view) => sum + (view.handover?.actualCashPaise ?? 0),
          0,
        ),
        digitalPaise: views.reduce((sum, view) => sum + view.cash.digitalPaise, 0),
        unresolvedDifferencePaise: open.reduce(
          (sum, view) => sum + (view.handover?.differencePaise ?? 0),
          0,
        ),
      },
      unattributedCash: {
        transactions: unattributed._count._all,
        amountPaise: unattributed._sum.amountPaise ?? 0,
      },
      administratorCash: {
        transactions: administrator._count._all,
        amountPaise: administrator._sum.amountPaise ?? 0,
      },
      awaitingHandover: await toShiftViews(awaiting),
      openDiscrepancies: open,
    };
  },
};
