import { createHmac, randomInt } from 'node:crypto';

import { EXIT_CODE_LENGTH, type ExitCodeResponse, type ScanCheckoutResponse } from '@cpvts/shared';

import { config } from '../../config/index.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import {
  auditRejection,
  channelMetadata,
  type ActorContext,
  type OperationContext,
} from './operation-context.js';
import { parkingErrors } from './parking.errors.js';
import { parkingRepository } from './parking.repository.js';
import { verifyActiveSession } from './session-verification.js';

/**
 * The 6-digit exit code: the fallback when the session QR cannot be scanned (cracked screen,
 * glare, no camera). The owner or visitor asks the server for a code for their own ACTIVE
 * session; the gate types it in and gets the same verified session a QR scan returns.
 *
 *  - issued only by the server (cryptographically random), shown once; only a keyed hash is
 *    stored, so a database leak does not reveal live codes,
 *  - session-specific and short-lived (`EXIT_CODE_TTL_SECONDS`); issuing again replaces the
 *    previous code,
 *  - guessing is throttled per operator (see `exitCodeRateLimiter`) and every refusal is audited,
 *  - deleted when the checkout is finalized (or when the session is no longer ACTIVE it simply
 *    stops resolving).
 *
 * Like the QR, the code only identifies the session: it never completes a checkout.
 */
const hashCode = (code: string): string =>
  createHmac('sha256', config.jwt.secret).update(`exit-code:${code}`).digest('hex');

const newCode = (): string =>
  String(randomInt(0, 10 ** EXIT_CODE_LENGTH)).padStart(EXIT_CODE_LENGTH, '0');

export const exitCodeService = {
  /** Issues a fresh code for an ACTIVE session, replacing any earlier one. */
  async issue(sessionId: string, context: ActorContext): Promise<ExitCodeResponse> {
    const session = await prisma.parkingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, sessionNumber: true, status: true },
    });
    if (!session) throw parkingErrors.sessionNotFound();
    if (session.status !== 'ACTIVE') throw parkingErrors.sessionNotActive();

    const ttlSeconds = config.parking.exitCodeTtlSeconds;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const code = await withTransaction(async (tx) => {
      // This session's earlier codes and everyone's expired ones are of no further use.
      await tx.exitCode.deleteMany({
        where: { OR: [{ sessionId: session.id }, { expiresAt: { lt: new Date() } }] },
      });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = newCode();
        const codeHash = hashCode(candidate);
        // A live code must identify exactly one session.
        const taken = await tx.exitCode.count({
          where: { codeHash, expiresAt: { gt: new Date() } },
        });
        if (taken === 0) {
          await tx.exitCode.create({ data: { sessionId: session.id, codeHash, expiresAt } });
          return candidate;
        }
      }
      throw new Error('Could not generate a unique exit code');
    });

    await auditRepository.record({
      action: AUDIT_ACTIONS.exitCodeIssued,
      actorId: context.actor?.id ?? null,
      entityType: AUDIT_ENTITY_TYPES.parkingSession,
      entityId: session.sessionNumber,
      metadata: { ttlSeconds, ...channelMetadata(context) },
      request: context.request,
    });

    return {
      sessionNumber: session.sessionNumber,
      code,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds,
    };
  },

  /** The gate typed a code: returns the verified ACTIVE session, or refuses without detail. */
  async resolve(code: string, context: OperationContext): Promise<ScanCheckoutResponse> {
    const matches = await prisma.exitCode.findMany({
      where: { codeHash: hashCode(code.trim()), expiresAt: { gt: new Date() } },
      select: { session: { select: { sessionNumber: true } } },
      take: 2,
    });
    // Wrong, expired, already used and ambiguous codes are indistinguishable to the caller.
    const sessionNumber = matches.length === 1 ? matches[0]?.session.sessionNumber : undefined;
    const session = sessionNumber
      ? await parkingRepository.findSessionByNumber(sessionNumber)
      : null;
    if (!session) {
      throw await auditRejection(parkingErrors.invalidExitCode(), context, {
        metadata: { source: 'EXIT_CODE' },
      });
    }

    const verified = await verifyActiveSession(session, 'EXIT_CODE', context);

    await auditRepository.record({
      action: AUDIT_ACTIONS.checkoutCodeEntered,
      actorId: context.actor.id,
      entityType: AUDIT_ENTITY_TYPES.parkingSession,
      entityId: session.sessionNumber,
      metadata: channelMetadata(context),
      request: context.request,
    });

    return verified;
  },
};
