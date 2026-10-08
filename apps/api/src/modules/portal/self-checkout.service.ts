import type {
  CheckoutQuote,
  CreatePaymentResponse,
  PaymentMethod,
  PaymentView,
  ProcessPaymentResponse,
} from '@cpvts/shared';

import { campusHour } from '../../lib/campus-time.js';
import { checkoutService } from '../parking/checkout.service.js';
import type { ActorContext, OperationContext } from '../parking/operation-context.js';
import { parkingErrors } from '../parking/parking.errors.js';
import { parkingRepository } from '../parking/parking.repository.js';
import { findOwnSession } from './portal-access.js';

/** Self-service checkout runs as the account holder on the SELF_SERVICE channel. */
const asOwner = (context: OperationContext): ActorContext => ({
  actor: { id: context.actor.id },
  request: context.request,
  channel: 'SELF_SERVICE',
});

/** The payment, only if it belongs to the stated session (which the caller already owns). */
export const assertPaymentOfSession = async (
  paymentId: string,
  sessionNumber: string,
): Promise<void> => {
  const payment = await parkingRepository.findPaymentWithSessionNumber(paymentId);
  if (!payment || payment.session.sessionNumber !== sessionNumber) {
    throw parkingErrors.paymentNotFound();
  }
};

/**
 * Student / Campus Staff checkout. It is the same checkout, payment,
 * finalization and receipt code the security desk uses — the user only
 * differs in who may start it (the vehicle's owner, for their own active
 * session) and in the exit hour, which is the server's current campus hour.
 * The fee is whatever the backend fee engine returns.
 */
export const selfCheckoutService = {
  async quote(sessionNumber: string, context: OperationContext): Promise<CheckoutQuote> {
    await findOwnSession(context.actor.id, sessionNumber);
    return checkoutService.quote({ sessionNumber, exitHour: campusHour() }, asOwner(context));
  },

  async createPayment(
    sessionNumber: string,
    method: PaymentMethod,
    context: OperationContext,
  ): Promise<CreatePaymentResponse> {
    await findOwnSession(context.actor.id, sessionNumber);
    return checkoutService.createPayment(
      { sessionNumber, exitHour: campusHour(), method },
      asOwner(context),
    );
  },

  async processPayment(
    paymentId: string,
    sessionNumber: string,
    outcome: 'SUCCESS' | 'FAILURE',
    context: OperationContext,
  ): Promise<ProcessPaymentResponse> {
    await findOwnSession(context.actor.id, sessionNumber);
    await assertPaymentOfSession(paymentId, sessionNumber);
    return checkoutService.processPayment(paymentId, { sessionNumber, outcome }, asOwner(context));
  },

  async cancelPayment(
    paymentId: string,
    sessionNumber: string,
    context: OperationContext,
  ): Promise<PaymentView> {
    await findOwnSession(context.actor.id, sessionNumber);
    await assertPaymentOfSession(paymentId, sessionNumber);
    return checkoutService.cancelPayment(paymentId, sessionNumber, asOwner(context));
  },
};
