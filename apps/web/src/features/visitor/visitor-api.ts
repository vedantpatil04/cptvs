import type {
  CheckoutQuote,
  CreatePaymentResponse,
  ExitRequestState,
  MOCK_PAYMENT_OUTCOMES,
  ParkingMapResponse,
  ParkingSessionView,
  PaymentMethod,
  PaymentView,
  ProcessPaymentResponse,
  ReceiptView,
  SessionTimelineResponse,
  VisitorAccessRequest,
  VisitorAccessResponse,
} from '@cpvts/shared';

import { apiRequest } from '@/lib/api-client';

type MockPaymentOutcome = (typeof MOCK_PAYMENT_OUTCOMES)[number];

export const visitorApi = {
  access: (data: VisitorAccessRequest) =>
    apiRequest<VisitorAccessResponse>('/visitor/access', {
      method: 'POST',
      body: data,
      authenticated: false,
    }),

  session: (token: string) =>
    apiRequest<ParkingSessionView>('/visitor/session', { token }),

  layout: (token: string) =>
    apiRequest<ParkingMapResponse>('/visitor/layout', { token }),

  timeline: (token: string) =>
    apiRequest<SessionTimelineResponse>('/visitor/timeline', { token }),

  quote: (token: string) =>
    apiRequest<CheckoutQuote>('/visitor/checkout/quote', {
      method: 'POST',
      token,
    }),

  requestExit: (token: string) =>
    apiRequest<ExitRequestState>('/visitor/exit-request', {
      method: 'POST',
      token,
    }),

  cancelExitRequest: (token: string) =>
    apiRequest<ExitRequestState>('/visitor/exit-request', {
      method: 'DELETE',
      token,
    }),

  createPayment: (token: string, method: PaymentMethod) =>
    apiRequest<CreatePaymentResponse>('/visitor/checkout/payments', {
      method: 'POST',
      body: { method },
      token,
    }),

  processPayment: (
    token: string,
    paymentId: string,
    outcome: MockPaymentOutcome = 'SUCCESS',
  ) =>
    apiRequest<ProcessPaymentResponse>(`/visitor/checkout/payments/${paymentId}/process`, {
      method: 'POST',
      body: { outcome },
      token,
    }),

  cancelPayment: (token: string, paymentId: string) =>
    apiRequest<{ payment: PaymentView }>(`/visitor/checkout/payments/${paymentId}/cancel`, {
      method: 'POST',
      token,
    }),

  receipt: (token: string) =>
    apiRequest<ReceiptView>('/visitor/receipt', { token }),
};
