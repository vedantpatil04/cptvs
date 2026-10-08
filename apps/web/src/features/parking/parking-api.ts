import type {
  ActiveSessionsResponse,
  CheckInRequest,
  CheckInResponse,
  CheckoutQuote,
  CheckoutQuoteRequest,
  CreatePaymentRequest,
  CreatePaymentResponse,
  DashboardSummary,
  ParkingMapResponse,
  ParkingSessionView,
  PaymentView,
  ProcessPaymentResponse,
  ReceiptVerificationResponse,
  ReceiptView,
  TrackingResponse,
} from '@cpvts/shared';

import { apiRequest } from '@/lib/api-client';

/** Thin client for the parking endpoints. All calculations happen on the server. */
export const parkingApi = {
  checkIn: (body: CheckInRequest) =>
    apiRequest<CheckInResponse>('/parking/check-ins', { method: 'POST', body }),

  track: (query: string, signal?: AbortSignal) =>
    apiRequest<TrackingResponse>(`/parking/tracking?q=${encodeURIComponent(query)}`, { signal }),

  map: (signal: AbortSignal) => apiRequest<ParkingMapResponse>('/parking/map', { signal }),

  activeSessions: (signal: AbortSignal) =>
    apiRequest<ActiveSessionsResponse>('/parking/sessions/active', { signal }),

  session: (sessionNumber: string, signal?: AbortSignal) =>
    apiRequest<ParkingSessionView>(`/parking/sessions/${encodeURIComponent(sessionNumber)}`, {
      signal,
    }),

  quote: (body: CheckoutQuoteRequest) =>
    apiRequest<CheckoutQuote>('/parking/checkouts/quote', { method: 'POST', body }),

  createPayment: (body: CreatePaymentRequest) =>
    apiRequest<CreatePaymentResponse>('/parking/payments', { method: 'POST', body }),

  processPayment: (paymentId: string, sessionNumber: string, outcome: 'SUCCESS' | 'FAILURE') =>
    apiRequest<ProcessPaymentResponse>(`/parking/payments/${paymentId}/process`, {
      method: 'POST',
      body: { sessionNumber, outcome },
    }),

  cancelPayment: (paymentId: string, sessionNumber: string) =>
    apiRequest<{ payment: PaymentView }>(`/parking/payments/${paymentId}/cancel`, {
      method: 'POST',
      body: { sessionNumber },
    }),

  receipt: (receiptNumber: string, signal?: AbortSignal) =>
    apiRequest<ReceiptView>(`/parking/receipts/${encodeURIComponent(receiptNumber)}`, { signal }),

  summary: (signal: AbortSignal) => apiRequest<DashboardSummary>('/dashboard/summary', { signal }),

  verifyReceipt: (reference: string, signal?: AbortSignal) =>
    apiRequest<ReceiptVerificationResponse>(`/public/receipts/${encodeURIComponent(reference)}`, {
      signal,
      authenticated: false,
    }),
};
