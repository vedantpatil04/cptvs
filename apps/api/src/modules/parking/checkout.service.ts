import {
  OPAQUE_REFERENCE_PATTERN,
  parseEntryQrPayload,
  type CheckoutQuote,
  type CreatePaymentResponse,
  type PaymentMethod,
  type PaymentView,
  type ProcessPaymentResponse,
} from '@cpvts/shared';

import { config } from '../../config/index.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { campusHour, campusYear } from '../../lib/campus-time.js';
import { AppError } from '../../lib/errors.js';
import { newOpaqueReference, newReceiptNumber, newTransactionId } from '../../lib/identifiers.js';
import { logger } from '../../lib/logger.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { notificationService } from '../notifications/notification.service.js';
import { calculateDurationHours, calculateFee } from '../fees/fee-engine.js';
import { feeScheduleService } from '../fees/fee-schedule.service.js';
import { shiftErrors } from '../shifts/shift.errors.js';
import { auditRejection, channelMetadata, type ActorContext } from './operation-context.js';
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
  /** The scanned session QR (or its bare reference); it must belong to this session. */
  entryReference?: string;
}

interface PreparedCheckout {
  session: SessionWithRelations;
  quote: CheckoutQuote;
}

/**
 * Checkout is gate-controlled: only the operational workflow (Security Staff, or an
 * administrator overriding) may start a payment or finalize a session. A Student, Campus
 * Staff member or Visitor acts through the SELF_SERVICE / VISITOR channels, which can see a
 * preview of the amount but never reach a payment — this guard makes that a hard rule of
 * the service itself, not only of the routes in front of it.
 */
const assertGateChannel = (context: ActorContext): void => {
  if (context.channel || !context.actor) throw parkingErrors.gateCheckoutRequired();
};

/** The reference carried by a scanned QR text, or null if it is not a CPVTS session QR. */
const referenceOf = (scanned: string): string | null => {
  const text = scanned.trim();
  return parseEntryQrPayload(text) ?? (OPAQUE_REFERENCE_PATTERN.test(text) ? text : null);
};

/**
 * Verifies the session and the operator's identifiers, validates the exit hour
 * and prices the stay with the authoritative fee engine. No state changes.
 */
const prepareCheckout = async (
  request: CheckoutRequest,
  context: ActorContext,
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
  if (request.entryReference !== undefined) {
    const reference = referenceOf(request.entryReference);
    if (!reference) {
      throw await auditRejection(parkingErrors.invalidQrReference(), context, {
        ...subject,
        metadata: { source: 'ENTRY_QR' },
      });
    }
    if (reference !== session.entryReference) {
      throw await auditRejection(parkingErrors.qrSessionMismatch(), context, {
        ...subject,
        metadata: { source: 'ENTRY_QR' },
      });
    }
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
  /**
   * Step 1: fee preview with a transparent breakdown. The gate records it (an audit entry);
   * a user's or visitor's own "what would I owe" preview passes `record: false` and leaves
   * no trace — it is not the start of a checkout.
   */
  async quote(
    request: CheckoutRequest,
    context: ActorContext,
    { record = true }: { record?: boolean } = {},
  ): Promise<CheckoutQuote> {
    const { session, quote } = await prepareCheckout(request, context);
    if (record) {
      await auditRepository.record({
        action: AUDIT_ACTIONS.checkoutInitiated,
        actorId: context.actor?.id,
        entityType: AUDIT_ENTITY_TYPES.parkingSession,
        entityId: session.sessionNumber,
        metadata: {
          exitHour: quote.exitHour,
          durationHours: quote.durationHours,
          totalPaise: quote.fee.totalPaise,
          ...channelMetadata(context),
        },
        request: context.request,
      });
    }
    return quote;
  },

  /**
   * Step 2: creates a PENDING simulated payment for the authoritative amount.
   * Any earlier pending attempt for the session is cancelled. The payment belongs to the
   * operator's duty shift from this moment, so cash taken is the shift's responsibility.
   */
  async createPayment(
    request: CheckoutRequest & { method: PaymentMethod },
    context: ActorContext,
  ): Promise<CreatePaymentResponse> {
    assertGateChannel(context);
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
          shiftId: context.shiftId ?? null,
        },
      });
      await auditRepository.record(
        {
          action: AUDIT_ACTIONS.paymentInitiated,
          actorId: context.actor?.id,
          entityType: AUDIT_ENTITY_TYPES.payment,
          entityId: created.transactionId,
          metadata: {
            sessionNumber: session.sessionNumber,
            method: created.method,
            amountPaise: created.amountPaise,
            simulated: true,
            ...channelMetadata(context),
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
   * transaction atomically: payment PAID (by this operator, in this shift), session
   * COMPLETED with frozen duration/fee, receipt issued, slot released. Any failure rolls back.
   * A shift that ends while the payment is open does not stop it from completing.
   */
  async processPayment(
    paymentId: string,
    request: { sessionNumber: string; outcome: 'SUCCESS' | 'FAILURE' },
    context: ActorContext,
  ): Promise<ProcessPaymentResponse> {
    assertGateChannel(context);
    const payment = await loadPaymentForSession(paymentId, request.sessionNumber, context);

    // Accountability: Security Staff finalize under a shift (the payment's own, or their active
    // one). The payment's shift stays valid after the shift's end so an in-flight transaction
    // is never broken; an administrator override needs none.
    if (!context.override && config.shifts.enforcement === 'required') {
      if (!(payment.shiftId ?? context.shiftId)) throw shiftErrors.required();
    }

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
    context: ActorContext,
  ): Promise<PaymentView> {
    assertGateChannel(context);
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
          actorId: context.actor?.id,
          entityType: AUDIT_ENTITY_TYPES.payment,
          entityId: payment.transactionId,
          metadata: { sessionNumber, ...channelMetadata(context) },
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
  context: ActorContext,
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

const markFailed = async (paymentId: string, reason: string, context: ActorContext) =>
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
        actorId: context.actor?.id,
        entityType: AUDIT_ENTITY_TYPES.payment,
        entityId: failed.transactionId,
        metadata: {
          sessionNumber: failed.session.sessionNumber,
          reason,
          simulated: true,
          ...channelMetadata(context),
        },
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
const finalize = async (tx: Prisma.TransactionClient, paymentId: string, context: ActorContext) => {
  const operatorId = context.actor?.id;
  if (!operatorId) throw parkingErrors.gateCheckoutRequired();

  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const session = await tx.parkingSession.findUniqueOrThrow({
    where: { id: payment.sessionId },
    include: { slot: true },
  });
  if (session.status !== 'ACTIVE') throw parkingErrors.sessionNotActive();

  // The payment belongs to the shift it was created in, unless it had none; a reconciled
  // (closed) shift's cash can no longer change.
  const shiftId = payment.shiftId ?? context.shiftId ?? null;
  if (shiftId) {
    const shift = await tx.securityShift.findUnique({
      where: { id: shiftId },
      select: { status: true },
    });
    if (!shift || shift.status === 'CLOSED') throw shiftErrors.invalidState();
  }

  // Re-price with the authoritative engine; it must equal the amount being paid.
  const schedule = await feeScheduleService.require();
  const durationHours = calculateDurationHours(session.entryHour, payment.exitHour);
  const fee = calculateFee(schedule, session.ownerCategory, session.vehicleType, durationHours);
  if (fee.totalPaise !== payment.amountPaise) throw parkingErrors.paymentAmountMismatch();

  const now = new Date();

  const paid = await tx.payment.updateMany({
    where: { id: payment.id, status: 'PROCESSING', sessionId: session.id },
    data: { status: 'PAID', paidAt: now, processedById: operatorId, shiftId },
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
      checkedOutById: operatorId,
      checkedOutVia: 'SECURITY',
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

  // The session is over: its exit code (the QR fallback) must not work any more.
  await tx.exitCode.deleteMany({ where: { sessionId: session.id } });

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

  const audit = (
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    entityType: (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES],
    entityId: string,
    metadata: Prisma.InputJsonObject,
  ) =>
    auditRepository.record(
      {
        action,
        actorId: operatorId,
        entityType,
        entityId,
        metadata: { ...metadata, ...channelMetadata({ ...context, shiftId }) },
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

  // Tell the account that owned the vehicle for this session that the receipt is ready.
  if (session.ownerUserId) {
    await notificationService.notify(
      session.ownerUserId,
      'RECEIPT_GENERATED',
      {
        receiptNumber: receipt.receiptNumber,
        sessionNumber: session.sessionNumber,
        amountPaise: receipt.amountPaise,
      },
      tx,
    );
  }

  return receipt;
};
