import type {
  CheckoutQuote,
  CreatePaymentResponse,
  PaymentMethod,
  PaymentView,
  ProcessPaymentResponse,
} from '@cpvts/shared';

import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { campusHour, campusYear } from '../../lib/campus-time.js';
import { AppError } from '../../lib/errors.js';
import { newOpaqueReference, newReceiptNumber, newTransactionId } from '../../lib/identifiers.js';
import { logger } from '../../lib/logger.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { calculateDurationHours, calculateFee } from '../fees/fee-engine.js';
import { feeScheduleService } from '../fees/fee-schedule.service.js';
import { notificationService } from '../notifications/notification.service.js';
import { auditRejection, type CheckoutContext } from './operation-context.js';
import { parkingErrors } from './parking.errors.js';
import { toPaymentView, toReceiptView, toSessionView } from './parking.mappers.js';
import {
  parkingRepository,
  RECEIPT_INCLUDE,
  type SessionWithRelations,
} from './parking.repository.js';

export interface CheckoutRequest {
  sessionNumber: string;
  exitHour: number;
  /** Optional identifiers the operator used; each must match the session. */
  vehicleNumber?: string;
  slotCode?: string;
}

interface PreparedCheckout {
  session: SessionWithRelations;
  quote: CheckoutQuote;
}

/**
 * Verifies the session and the operator's identifiers, validates the exit hour
 * and prices the stay with the authoritative fee engine. No state changes.
 */
const prepareCheckout = async (
  request: CheckoutRequest,
  context: CheckoutContext,
): Promise<PreparedCheckout> => {
  const session = await parkingRepository.findSessionByNumber(request.sessionNumber);
  if (!session) throw parkingErrors.sessionNotFound();

  const subject = {
    entityType: AUDIT_ENTITY_TYPES.parkingSession,
    entityId: session.sessionNumber,
  } as const;

  if (session.status !== 'ACTIVE') {
    throw await auditRejection(parkingErrors.sessionNotActive(), context, {
      ...subject,
      metadata: { reason: 'REPEATED_CHECKOUT' },
    });
  }
  if (request.vehicleNumber && request.vehicleNumber !== session.vehicle.vehicleNumber) {
    throw await auditRejection(parkingErrors.vehicleSessionMismatch(), context, {
      ...subject,
      metadata: { providedVehicleNumber: request.vehicleNumber },
    });
  }
  if (request.slotCode && request.slotCode !== session.slot.code) {
    throw await auditRejection(parkingErrors.sessionSlotMismatch(), context, {
      ...subject,
      metadata: { providedSlotCode: request.slotCode },
    });
  }

  let durationHours: number;
  try {
    durationHours = calculateDurationHours(session.entryHour, request.exitHour);
  } catch (error) {
    if (error instanceof AppError) {
      throw await auditRejection(error, context, {
        ...subject,
        metadata: { entryHour: session.entryHour, exitHour: request.exitHour },
      });
    }
    throw error;
  }

  const schedule = await feeScheduleService.require();
  const fee = calculateFee(schedule, session.ownerCategory, session.vehicleType, durationHours);
  return {
    session,
    quote: {
      session: toSessionView(session, { currentHour: campusHour(), schedule }),
      exitHour: request.exitHour,
      durationHours,
      fee,
    },
  };
};

const allowedMethod = (amountPaise: number, method: PaymentMethod): boolean =>
  amountPaise === 0 ? method === 'NO_CHARGE' : method !== 'NO_CHARGE';

/** Generates a value not yet in use for a unique column. */
const uniqueValue = async (
  generate: () => string,
  exists: (value: string) => Promise<boolean>,
): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = generate();
    if (!(await exists(value))) return value;
  }
  throw new Error('Could not generate a unique identifier');
};

export const checkoutService = {
  /** Step 1: fee preview with a transparent breakdown. */
  async quote(request: CheckoutRequest, context: CheckoutContext): Promise<CheckoutQuote> {
    const { session, quote } = await prepareCheckout(request, context);
    await auditRepository.record({
      action: AUDIT_ACTIONS.checkoutInitiated,
      actorId: context.actor?.id ?? null,
      entityType: AUDIT_ENTITY_TYPES.parkingSession,
      entityId: session.sessionNumber,
      metadata: {
        exitHour: quote.exitHour,
        durationHours: quote.durationHours,
        totalPaise: quote.fee.totalPaise,
      },
      request: context.request,
    });
    return quote;
  },

  /**
   * Step 2: creates a PENDING simulated payment for the authoritative amount.
   * Any earlier pending attempt for the session is cancelled.
   */
  async createPayment(
    request: CheckoutRequest & { method: PaymentMethod },
    context: CheckoutContext,
  ): Promise<CreatePaymentResponse> {
    const { session, quote } = await prepareCheckout(request, context);
    if (!allowedMethod(quote.fee.totalPaise, request.method)) {
      throw parkingErrors.invalidPaymentMethod();
    }

    const payment = await withTransaction(async (tx) => {
      if (await tx.payment.count({ where: { sessionId: session.id, status: 'PROCESSING' } })) {
        throw parkingErrors.paymentInProgress();
      }
      await tx.payment.updateMany({
        where: { sessionId: session.id, status: 'PENDING' },
        data: { status: 'CANCELLED', failureReason: 'SUPERSEDED' },
      });
      const transactionId = await uniqueValue(
        newTransactionId,
        async (value) => (await tx.payment.count({ where: { transactionId: value } })) > 0,
      );
      const created = await tx.payment.create({
        data: {
          sessionId: session.id,
          transactionId,
          method: request.method,
          status: 'PENDING',
          amountPaise: quote.fee.totalPaise,
          exitHour: quote.exitHour,
          isSimulated: true,
        },
      });
      await auditRepository.record(
        {
          action: AUDIT_ACTIONS.paymentInitiated,
          actorId: context.actor?.id ?? null,
          entityType: AUDIT_ENTITY_TYPES.payment,
          entityId: created.transactionId,
          metadata: {
            sessionNumber: session.sessionNumber,
            method: created.method,
            amountPaise: created.amountPaise,
            simulated: true,
          },
          request: context.request,
        },
        tx,
      );
      return created;
    });

    return { payment: toPaymentView(payment), quote };
  },

  /**
   * Step 3: runs the simulated provider and, on success, finalizes the
   * transaction atomically: payment PAID, session COMPLETED with frozen
   * duration/fee, receipt issued, slot released. Any failure rolls back.
   */
  async processPayment(
    paymentId: string,
    request: { sessionNumber: string; outcome: 'SUCCESS' | 'FAILURE' },
    context: CheckoutContext,
  ): Promise<ProcessPaymentResponse> {
    const payment = await loadPaymentForSession(paymentId, request.sessionNumber, context);

    // PENDING → PROCESSING is the lock against double processing.
    const claimed = await withTransaction((tx) =>
      tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'PROCESSING' },
      }),
    );
    if (claimed.count !== 1) throw parkingErrors.paymentNotPending();

    // A ₹0 (no-charge) checkout has nothing to decline.
    if (request.outcome === 'FAILURE' && payment.method !== 'NO_CHARGE') {
      const failed = await markFailed(payment.id, 'DECLINED_BY_TEST_PROVIDER', context);
      return { payment: toPaymentView(failed), receipt: null };
    }

    try {
      const receipt = await withTransaction((tx) => finalize(tx, payment.id, context), {
        timeoutMs: 15_000,
      });
      return { payment: toPaymentView(receipt.payment), receipt: toReceiptView(receipt) };
    } catch (error) {
      const reason = error instanceof AppError ? error.code : 'FINALIZATION_FAILED';
      await markFailed(payment.id, reason.slice(0, 64), context);
      if (error instanceof AppError) {
        throw await auditRejection(error, context, {
          entityType: AUDIT_ENTITY_TYPES.payment,
          entityId: payment.transactionId,
        });
      }
      logger.error('checkout finalization failed', { paymentId: payment.id, err: error });
      throw error;
    }
  },

  /** Cancels a pending payment (operator backs out before paying). */
  async cancelPayment(
    paymentId: string,
    sessionNumber: string,
    context: CheckoutContext,
  ): Promise<PaymentView> {
    const payment = await loadPaymentForSession(paymentId, sessionNumber, context);
    const cancelled = await withTransaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'CANCELLED', failureReason: 'CANCELLED_BY_OPERATOR' },
      });
      if (count !== 1) throw parkingErrors.paymentNotPending();
      await auditRepository.record(
        {
          action: AUDIT_ACTIONS.paymentCancelled,
          actorId: context.actor?.id ?? null,
          entityType: AUDIT_ENTITY_TYPES.payment,
          entityId: payment.transactionId,
          metadata: { sessionNumber },
          request: context.request,
        },
        tx,
      );
      return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    });
    return toPaymentView(cancelled);
  },
};

/** Loads a payment and rejects it unless it belongs to the stated session. */
const loadPaymentForSession = async (
  paymentId: string,
  sessionNumber: string,
  context: CheckoutContext,
) => {
  const payment = await parkingRepository.findPaymentWithSessionNumber(paymentId);
  if (!payment) throw parkingErrors.paymentNotFound();
  if (payment.session.sessionNumber !== sessionNumber) {
    throw await auditRejection(parkingErrors.paymentSessionMismatch(), context, {
      entityType: AUDIT_ENTITY_TYPES.payment,
      entityId: payment.transactionId,
      metadata: { providedSessionNumber: sessionNumber },
    });
  }
  return payment;
};

const markFailed = async (paymentId: string, reason: string, context: CheckoutContext) =>
  withTransaction(async (tx) => {
    await tx.payment.updateMany({
      where: { id: paymentId, status: 'PROCESSING' },
      data: { status: 'FAILED', failureReason: reason },
    });
    const failed = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { session: { select: { sessionNumber: true } } },
    });
    await auditRepository.record(
      {
        action: AUDIT_ACTIONS.paymentFailed,
        actorId: context.actor?.id ?? null,
        entityType: AUDIT_ENTITY_TYPES.payment,
        entityId: failed.transactionId,
        metadata: { sessionNumber: failed.session.sessionNumber, reason, simulated: true },
        request: context.request,
      },
      tx,
    );
    return failed;
  });

/**
 * The single finalization step (Master Blueprint §29). Every write is a
 * conditional update; if any precondition no longer holds, an error is thrown
 * and the whole transaction rolls back.
 */
const finalize = async (
  tx: Prisma.TransactionClient,
  paymentId: string,
  context: CheckoutContext,
) => {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const session = await tx.parkingSession.findUniqueOrThrow({
    where: { id: payment.sessionId },
    include: { slot: true },
  });
  if (session.status !== 'ACTIVE') throw parkingErrors.sessionNotActive();

  // Re-price with the authoritative engine; it must equal the amount being paid.
  const schedule = await feeScheduleService.require();
  const durationHours = calculateDurationHours(session.entryHour, payment.exitHour);
  const fee = calculateFee(schedule, session.ownerCategory, session.vehicleType, durationHours);
  if (fee.totalPaise !== payment.amountPaise) throw parkingErrors.paymentAmountMismatch();

  const now = new Date();

  const paid = await tx.payment.updateMany({
    where: { id: payment.id, status: 'PROCESSING', sessionId: session.id },
    data: { status: 'PAID', paidAt: now },
  });
  if (paid.count !== 1) throw parkingErrors.paymentNotPending();

  const completed = await tx.parkingSession.updateMany({
    where: { id: session.id, status: 'ACTIVE' },
    data: {
      status: 'COMPLETED',
      exitHour: payment.exitHour,
      exitAt: now,
      durationHours,
      feeAmountPaise: fee.totalPaise,
      feeBreakdown: fee as unknown as Prisma.InputJsonObject,
      checkedOutById: context.actor?.id ?? null,
    },
  });
  if (completed.count !== 1) throw parkingErrors.sessionNotActive();

  // Release the slot: OCCUPIED → AVAILABLE. A slot an administrator blocked
  // while occupied stays BLOCKED; any other state is an integrity violation.
  const released = await tx.parkingSlot.updateMany({
    where: { id: session.slotId, status: 'OCCUPIED' },
    data: { status: 'AVAILABLE' },
  });
  if (released.count !== 1 && session.slot.status !== 'BLOCKED') {
    throw new AppError(409, 'CONFLICT', 'The parking slot is not in the expected state.');
  }

  const receiptNumber = await uniqueValue(
    () => newReceiptNumber(campusYear(now)),
    async (value) => (await tx.receipt.count({ where: { receiptNumber: value } })) > 0,
  );
  const receipt = await tx.receipt.create({
    data: {
      receiptNumber,
      verificationReference: newOpaqueReference(),
      sessionId: session.id,
      paymentId: payment.id,
      amountPaise: payment.amountPaise,
      issuedAt: now,
    },
    include: RECEIPT_INCLUDE,
  });

  // Tell the vehicle's owner (if registered, and only for parking since they took ownership).
  const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: session.vehicleId } });
  if (vehicle.ownerUserId && vehicle.ownerSince && session.entryAt >= vehicle.ownerSince) {
    await notificationService.notify(tx, vehicle.ownerUserId, 'RECEIPT_GENERATED', {
      receiptNumber: receipt.receiptNumber,
      amountPaise: receipt.amountPaise,
      vehicleNumber: vehicle.vehicleNumber,
      sessionNumber: session.sessionNumber,
    });
  }

  const audit = (
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    entityType: (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES],
    entityId: string,
    metadata: Prisma.InputJsonObject,
  ) =>
    auditRepository.record(
      {
        action,
        actorId: context.actor?.id ?? null,
        entityType,
        entityId,
        metadata,
        request: context.request,
      },
      tx,
    );

  await audit(AUDIT_ACTIONS.paymentSucceeded, AUDIT_ENTITY_TYPES.payment, payment.transactionId, {
    sessionNumber: session.sessionNumber,
    method: payment.method,
    amountPaise: payment.amountPaise,
    simulated: true,
  });
  await audit(
    AUDIT_ACTIONS.transactionFinalized,
    AUDIT_ENTITY_TYPES.parkingSession,
    session.sessionNumber,
    {
      exitHour: payment.exitHour,
      durationHours,
      totalPaise: fee.totalPaise,
      transactionId: payment.transactionId,
    },
  );
  await audit(AUDIT_ACTIONS.receiptGenerated, AUDIT_ENTITY_TYPES.receipt, receipt.receiptNumber, {
    sessionNumber: session.sessionNumber,
    transactionId: payment.transactionId,
    amountPaise: receipt.amountPaise,
  });
  if (released.count === 1) {
    await audit(AUDIT_ACTIONS.slotReleased, AUDIT_ENTITY_TYPES.parkingSlot, session.slot.code, {
      sessionNumber: session.sessionNumber,
    });
  }

  return receipt;
};
