import type {
  CheckoutQuote,
  CreatePaymentResponse,
  ParkingSessionView,
  PaymentMethod,
  PaymentView,
  PortalLayoutResponse,
  ProcessPaymentResponse,
  ReceiptView,
  VisitorAccessRequest,
  VisitorAccessResponse,
} from '@cpvts/shared';

import { apiRequest } from '@/lib/api-client';

/** Visitor endpoints: the token is passed explicitly and never touches the account session. */
export const visitorApi = {
  access: (body: VisitorAccessRequest) =>
    apiRequest<VisitorAccessResponse>('/visitor/access', {
      method: 'POST',
      body,
      authenticated: false,
    }),

  session: (token: string, signal?: AbortSignal) =>
    apiRequest<ParkingSessionView>('/visitor/session', { signal, token }),

  layout: (token: string, signal?: AbortSignal) =>
    apiRequest<PortalLayoutResponse>('/visitor/layout', { signal, token }),

  receipt: (token: string, signal?: AbortSignal) =>
    apiRequest<ReceiptView>('/visitor/receipt', { signal, token }),

  // --- Checkout and simulated payment for the visitor's own session; the server picks the exit hour ---

  checkoutQuote: (token: string) =>
    apiRequest<CheckoutQuote>('/visitor/checkout', { method: 'POST', token }),

  createPayment: (token: string, method: PaymentMethod) =>
    apiRequest<CreatePaymentResponse>('/visitor/payments', {
      method: 'POST',
      body: { method },
      token,
    }),

  processPayment: (token: string, paymentId: string, outcome: 'SUCCESS' | 'FAILURE' = 'SUCCESS') =>
    apiRequest<ProcessPaymentResponse>(
      `/visitor/payments/${encodeURIComponent(paymentId)}/process`,
      { method: 'POST', body: { outcome }, token },
    ),

  cancelPayment: (token: string, paymentId: string) =>
    apiRequest<{ payment: PaymentView }>(
      `/visitor/payments/${encodeURIComponent(paymentId)}/cancel`,
      { method: 'POST', token },
    ),
};
