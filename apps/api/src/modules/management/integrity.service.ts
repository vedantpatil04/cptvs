import { INTEGRITY_CHECKS, type IntegrityCheckCode, type IntegrityReport } from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { AUDIT_ACTIONS } from '../audit/audit-actions.js';
import { isReceiptConsistent } from '../parking/receipt.service.js';
import { RECEIPT_INCLUDE } from '../parking/parking.repository.js';

/** A PROCESSING payment older than this is considered stuck. */
const STUCK_PAYMENT_MS = 5 * 60_000;
/** Findings listed per check (the count is still reflected by `passed`). */
const MAX_FINDINGS = 50;

type Check = () => Promise<string[]>;

/**
 * Parking Integrity Engine (Master Blueprint §18).
 *
 * Every operation is already guarded in-line (conditional updates, unique
 * indexes, CHECK constraints, consistency checks before finalization) and
 * refusals are audited as INTEGRITY_REJECTED. This module adds a read-only
 * scan of the whole data set that proves those invariants hold, plus the
 * recent refusals, for administrators.
 */
const CHECKS: Record<IntegrityCheckCode, Check> = {
  async OCCUPIED_SLOT_HAS_ACTIVE_SESSION() {
    const slots = await prisma.parkingSlot.findMany({
      where: { status: 'OCCUPIED', sessions: { none: { status: 'ACTIVE' } } },
      select: { code: true },
      take: MAX_FINDINGS,
    });
    return slots.map((slot) => slot.code);
  },

  async ACTIVE_SESSION_SLOT_OCCUPIED() {
    const sessions = await prisma.parkingSession.findMany({
      where: { status: 'ACTIVE', slot: { status: { not: 'OCCUPIED' } } },
      select: { sessionNumber: true, slot: { select: { code: true, status: true } } },
      take: MAX_FINDINGS,
    });
    return sessions.map((s) => `${s.sessionNumber} (${s.slot.code}: ${s.slot.status})`);
  },

  async ONE_ACTIVE_SESSION_PER_VEHICLE() {
    const groups = await prisma.parkingSession.groupBy({
      by: ['vehicleId'],
      where: { status: 'ACTIVE' },
      _count: { _all: true },
      having: { vehicleId: { _count: { gt: 1 } } },
    });
    if (groups.length === 0) return [];
    const vehicles = await prisma.vehicle.findMany({
      where: { id: { in: groups.map((group) => group.vehicleId) } },
      select: { vehicleNumber: true },
      take: MAX_FINDINGS,
    });
    return vehicles.map((vehicle) => vehicle.vehicleNumber);
  },

  async NO_EXPIRED_SLOT_HOLDS() {
    const slots = await prisma.parkingSlot.findMany({
      where: { status: 'HELD', holdExpiresAt: { lte: new Date() } },
      select: { code: true },
      take: MAX_FINDINGS,
    });
    return slots.map((slot) => slot.code);
  },

  async COMPLETED_SESSION_HAS_RECEIPT() {
    const sessions = await prisma.parkingSession.findMany({
      where: { status: 'COMPLETED', receipt: { is: null } },
      select: { sessionNumber: true },
      take: MAX_FINDINGS,
    });
    return sessions.map((session) => session.sessionNumber);
  },

  async PAID_PAYMENT_HAS_RECEIPT() {
    const payments = await prisma.payment.findMany({
      where: { status: 'PAID', receipt: { is: null } },
      select: { transactionId: true },
      take: MAX_FINDINGS,
    });
    return payments.map((payment) => payment.transactionId);
  },

  async RECEIPT_MATCHES_TRANSACTION() {
    const findings: string[] = [];
    const pageSize = 500;
    for (let skip = 0; findings.length < MAX_FINDINGS; skip += pageSize) {
      const receipts = await prisma.receipt.findMany({
        include: RECEIPT_INCLUDE,
        orderBy: { issuedAt: 'asc' },
        skip,
        take: pageSize,
      });
      for (const receipt of receipts) {
        if (!isReceiptConsistent(receipt)) findings.push(receipt.receiptNumber);
      }
      if (receipts.length < pageSize) break;
    }
    return findings.slice(0, MAX_FINDINGS);
  },

  async NO_STUCK_PAYMENTS() {
    const payments = await prisma.payment.findMany({
      where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - STUCK_PAYMENT_MS) } },
      select: { transactionId: true },
      take: MAX_FINDINGS,
    });
    return payments.map((payment) => payment.transactionId);
  },
};

export const integrityService = {
  async scan(): Promise<IntegrityReport> {
    const checks = await Promise.all(
      INTEGRITY_CHECKS.map(async (code) => {
        const findings = await CHECKS[code]();
        return { code, passed: findings.length === 0, findings };
      }),
    );
    const rejections = await prisma.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.integrityRejected },
      include: { actor: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      checkedAt: new Date().toISOString(),
      healthy: checks.every((check) => check.passed),
      checks,
      recentRejections: rejections.map((entry) => ({
        at: entry.createdAt.toISOString(),
        code: String((entry.metadata as { code?: unknown } | null)?.code ?? ''),
        actor: entry.actor?.username ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
      })),
    };
  },
};
