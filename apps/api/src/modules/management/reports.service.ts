import {
  OWNER_CATEGORIES,
  VEHICLE_TYPES,
  type HistoryFilters,
  type ReportKind,
} from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { addCampusDays, campusDateString, campusDateTimeString } from '../../lib/campus-time.js';
import { rupees, toCsv } from '../../lib/csv.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { OperationContext } from '../parking/operation-context.js';
import { resolveRange } from './date-range.js';
import { HISTORY_INCLUDE, historyWhere } from './history.service.js';

/** Upper bound on exported rows, to keep exports responsive. */
const MAX_ROWS = 50_000;

export interface CsvReport {
  filename: string;
  content: string;
  rows: number;
}

const historyCsv = async (filters: HistoryFilters): Promise<Omit<CsvReport, 'filename'>> => {
  const sessions = await prisma.parkingSession.findMany({
    where: historyWhere(filters),
    include: HISTORY_INCLUDE,
    orderBy: [{ entryAt: 'asc' }, { sessionNumber: 'asc' }],
    take: MAX_ROWS,
  });
  return {
    rows: sessions.length,
    content: toCsv(
      [
        'Receipt Number',
        'Session Number',
        'Vehicle Number',
        'Vehicle Type',
        'Owner Category',
        'Parking Block',
        'Slot',
        'Entry Hour',
        'Exit Hour',
        'Duration (hours)',
        'Fee (INR)',
        'Payment Status',
        'Transaction ID',
        'Session Status',
        'Entry Time',
        'Transaction Date',
      ],
      sessions.map((s) => [
        s.receipt?.receiptNumber,
        s.sessionNumber,
        s.vehicle.vehicleNumber,
        s.vehicleType,
        s.ownerCategory,
        s.slot.zone.block.name,
        s.slot.code,
        s.entryHour,
        s.exitHour,
        s.durationHours,
        rupees(s.feeAmountPaise),
        s.receipt?.payment.status,
        s.receipt?.payment.transactionId,
        s.status,
        campusDateTimeString(s.entryAt),
        s.exitAt ? campusDateTimeString(s.exitAt) : null,
      ]),
    ),
  };
};

const transactionsCsv = async (start: Date, end: Date) => {
  const payments = await prisma.payment.findMany({
    where: { createdAt: { gte: start, lt: end } },
    include: { session: { include: { vehicle: true } }, receipt: true },
    orderBy: [{ createdAt: 'asc' }, { transactionId: 'asc' }],
    take: MAX_ROWS,
  });
  return {
    rows: payments.length,
    content: toCsv(
      [
        'Transaction ID',
        'Created',
        'Status',
        'Method',
        'Amount (INR)',
        'Simulated',
        'Session Number',
        'Vehicle Number',
        'Exit Hour',
        'Receipt Number',
        'Paid At',
        'Failure Reason',
      ],
      payments.map((p) => [
        p.transactionId,
        campusDateTimeString(p.createdAt),
        p.status,
        p.method,
        rupees(p.amountPaise),
        p.isSimulated ? 'yes' : 'no',
        p.session.sessionNumber,
        p.session.vehicle.vehicleNumber,
        p.exitHour,
        p.receipt?.receiptNumber,
        p.paidAt ? campusDateTimeString(p.paidAt) : null,
        p.failureReason,
      ]),
    ),
  };
};

/** Daily revenue from finalized receipts only; days without revenue are listed as zero. */
const revenueCsv = async (from: string, to: string, start: Date, end: Date) => {
  const receipts = await prisma.receipt.findMany({
    where: { issuedAt: { gte: start, lt: end } },
    include: { session: { select: { vehicleType: true, ownerCategory: true } } },
  });
  const days = new Map<string, { count: number; total: number; byKey: Map<string, number> }>();
  for (let day = from; day <= to; day = addCampusDays(day, 1)) {
    days.set(day, { count: 0, total: 0, byKey: new Map() });
  }
  for (const receipt of receipts) {
    const bucket = days.get(campusDateString(receipt.issuedAt));
    if (!bucket) continue;
    bucket.count += 1;
    bucket.total += receipt.amountPaise;
    for (const key of [receipt.session.vehicleType, receipt.session.ownerCategory]) {
      bucket.byKey.set(key, (bucket.byKey.get(key) ?? 0) + receipt.amountPaise);
    }
  }
  const keys = [...VEHICLE_TYPES, ...OWNER_CATEGORIES];
  return {
    rows: days.size,
    content: toCsv(
      ['Date', 'Transactions', 'Revenue (INR)', ...keys.map((key) => `${key} (INR)`)],
      [...days.entries()].map(([day, bucket]) => [
        day,
        bucket.count,
        rupees(bucket.total),
        ...keys.map((key) => rupees(bucket.byKey.get(key) ?? 0)),
      ]),
    ),
  };
};

const vehiclesCsv = async () => {
  const vehicles = await prisma.vehicle.findMany({
    include: {
      sessions: { orderBy: { entryAt: 'desc' }, select: { entryAt: true, status: true } },
    },
    orderBy: { vehicleNumber: 'asc' },
    take: MAX_ROWS,
  });
  return {
    rows: vehicles.length,
    content: toCsv(
      [
        'Vehicle Number',
        'Vehicle Type',
        'First Seen',
        'Total Sessions',
        'Parked Now',
        'Last Entry',
      ],
      vehicles.map((v) => [
        v.vehicleNumber,
        v.vehicleType,
        campusDateTimeString(v.createdAt),
        v.sessions.length,
        v.sessions.some((s) => s.status === 'ACTIVE') ? 'yes' : 'no',
        v.sessions[0] ? campusDateTimeString(v.sessions[0].entryAt) : null,
      ]),
    ),
  };
};

/**
 * CSV exports (Master Blueprint §43). Every value is read from the stored,
 * finalized records — nothing is recalculated. Each export is audited.
 */
export const reportsService = {
  async export(
    kind: ReportKind,
    filters: HistoryFilters,
    context: OperationContext,
  ): Promise<CsvReport> {
    const range = resolveRange(filters);
    let report: Omit<CsvReport, 'filename'>;
    switch (kind) {
      case 'history':
        report = await historyCsv({ ...filters, from: range.from, to: range.to });
        break;
      case 'transactions':
        report = await transactionsCsv(range.start, range.end);
        break;
      case 'revenue':
        report = await revenueCsv(range.from, range.to, range.start, range.end);
        break;
      case 'vehicles':
        report = await vehiclesCsv();
        break;
    }

    await auditRepository.record({
      action: AUDIT_ACTIONS.reportExported,
      actorId: context.actor.id,
      entityType: AUDIT_ENTITY_TYPES.report,
      entityId: kind,
      metadata: { from: range.from, to: range.to, rows: report.rows },
      request: context.request,
    });
    const suffix = kind === 'vehicles' ? campusDateString() : `${range.from}_to_${range.to}`;
    return { ...report, filename: `cpvts-${kind}-${suffix}.csv` };
  },
};
