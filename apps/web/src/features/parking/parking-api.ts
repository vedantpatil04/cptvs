import type {
  ActivateArrivalResponse,
  AdjustSessionTimeRequest,
  AdjustSessionTimeResponse,
  ReleaseSlotReservationRequest,
  ReserveSlotRequest,
  SlotReservationsResponse,
  SlotReservationView,
  VipCheckInRequest,
  VipCheckInResponse,
  ActiveSessionsResponse,
  ArrivalLookupRequest,
  ArrivalResponse,
  PendingArrivalsResponse,
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
  ScanCheckoutResponse,
  TrackingResponse,
  VehicleLookupResponse,
} from '@cpvts/shared';

import { apiRequest } from '@/lib/api-client';

/** Thin client for the parking endpoints. All calculations happen on the server. */
export const parkingApi = {
  scanCheckout: (qr: string) =>
    apiRequest<ScanCheckoutResponse>('/parking/checkouts/scan', {
      method: 'POST',
      body: { qr },
    }),

  /** Fallback to the camera: the 6-digit exit code from the owner's or visitor's app. */
  codeCheckout: (code: string) =>
    apiRequest<ScanCheckoutResponse>('/parking/checkouts/code', {
      method: 'POST',
      body: { code },
    }),

  /** VIP / emergency slot reservations (Security manages, Admin views). */
  vipReservations: (includeHistory = false, signal?: AbortSignal) =>
    apiRequest<SlotReservationsResponse>(
      `/parking/vip-reservations${includeHistory ? '?history=true' : ''}`,
      { signal },
    ),

  reserveSlot: (body: ReserveSlotRequest) =>
    apiRequest<SlotReservationView>('/parking/vip-reservations', { method: 'POST', body }),

  releaseSlot: (id: string, body: ReleaseSlotReservationRequest = {}) =>
    apiRequest<SlotReservationView>(`/parking/vip-reservations/${encodeURIComponent(id)}/release`, {
      method: 'POST',
      body,
    }),

  vipCheckIn: (id: string, body: VipCheckInRequest) =>
    apiRequest<VipCheckInResponse>(`/parking/vip-reservations/${encodeURIComponent(id)}/check-in`, {
      method: 'POST',
      body,
    }),

  /** Visitors who reserved a space and are waiting to be verified at the gate. */
  pendingArrivals: (signal?: AbortSignal) =>
    apiRequest<PendingArrivalsResponse>('/parking/arrivals/pending', { signal }),

  findArrival: (body: ArrivalLookupRequest) =>
    apiRequest<ArrivalResponse>('/parking/arrivals/find', { method: 'POST', body }),

  /** Starts the real parking session for a verified arrival. */
  activateArrival: (reservationId: string) =>
    apiRequest<ActivateArrivalResponse>(
      `/parking/arrivals/${encodeURIComponent(reservationId)}/activate`,
      { method: 'POST' },
    ),

  lookup: (vehicleNumber: string, signal?: AbortSignal) =>
    apiRequest<VehicleLookupResponse>(
      `/parking/vehicle-lookup?vehicleNumber=${encodeURIComponent(vehicleNumber)}`,
      { signal },
    ),

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

  /** Security's audited correction of the recorded times; the reply is the fee priced afresh. */
  adjustTime: (sessionNumber: string, body: AdjustSessionTimeRequest) =>
    apiRequest<AdjustSessionTimeResponse>(`/parking/sessions/${sessionNumber}/adjust-time`, {
      method: 'POST',
      body,
    }),

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
