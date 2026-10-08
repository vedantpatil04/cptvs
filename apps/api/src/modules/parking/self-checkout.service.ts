import type {
  CheckoutQuote,
  CreatePaymentResponse,
  PaymentMethod,
  PaymentView,
  ProcessPaymentResponse,
} from '@cpvts/shared';

import { campusHour } from '../../lib/campus-time.js';
import { checkoutService } from './checkout.service.js';
import type { CheckoutContext } from './operation-context.js';
import { parkingErrors } from './parking.errors.js';
import { parkingRepository } from './parking.repository.js';

/**
 * Proves the caller may act on a session (a parking user owns it; a visitor
 * holds its slip). It must throw a not-found error otherwise, so another
 * person's session looks like it does not exist.
 */
export type SessionAccess = (sessionNumber: string) => Promise<void>;

/**
 * Self-service checkout for parking users and visitors. It is the operator's
 * checkout (same fee engine, same payment steps, same finalization and audit)
 * with one difference: the exit hour is the current campus hour, chosen by the
 * server, never by the client.
 */
export const selfCheckoutService = {
  async quote(
    sessionNumber: string,
    access: SessionAccess,
    context: CheckoutContext,
  ): Promise<CheckoutQuote> {
    await access(sessionNumber);
    return checkoutService.quote({ sessionNumber, exitHour: campusHour() }, context);
  },

  async createPayment(
    sessionNumber: string,
    method: PaymentMethod,
    access: SessionAccess,
    context: CheckoutContext,
  ): Promise<CreatePaymentResponse> {
    await access(sessionNumber);
    return checkoutService.createPayment(
      { sessionNumber, exitHour: campusHour(), method },
      context,
    );
  },

  async processPayment(
    paymentId: string,
    outcome: 'SUCCESS' | 'FAILURE',
    access: SessionAccess,
    context: CheckoutContext,
  ): Promise<ProcessPaymentResponse> {
    const sessionNumber = await sessionOfPayment(paymentId, access);
    return checkoutService.processPayment(paymentId, { sessionNumber, outcome }, context);
  },

  async cancelPayment(
    paymentId: string,
    access: SessionAccess,
    context: CheckoutContext,
  ): Promise<PaymentView> {
    const sessionNumber = await sessionOfPayment(paymentId, access);
    return checkoutService.cancelPayment(paymentId, sessionNumber, context);
  },
};

const sessionOfPayment = async (paymentId: string, access: SessionAccess): Promise<string> => {
  const payment = await parkingRepository.findPaymentWithSessionNumber(paymentId);
  if (!payment) throw parkingErrors.paymentNotFound();
  await access(payment.session.sessionNumber);
  return payment.session.sessionNumber;
};
