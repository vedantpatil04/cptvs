import type {
  CheckInResponse,
  CheckoutQuote,
  CreatePaymentResponse,
  HistoryItem,
  NotificationsResponse,
  Page,
  ParkCancelRequest,
  ParkConfirmRequest,
  ParkingSessionView,
  ParkingUserProfileView,
  ParkProposal,
  PaymentMethod,
  PaymentView,
  PortalHistoryQuery,
  PortalLayoutResponse,
  PortalOverview,
  ProcessPaymentResponse,
  ProfileUpdate,
  ReceiptView,
  RegisteredVehicle,
  RegisterVehicleRequest,
  SessionTimelineResponse,
  UpdateVehicleRequest,
  VerificationResubmission,
} from '@cpvts/shared';

import { queryString } from '@/features/admin/admin-api';
import { apiRequest } from '@/lib/api-client';

/** Student / Campus Staff portal. Every value is computed by the server. */
export const userApi = {
  profile: (signal?: AbortSignal) =>
    apiRequest<ParkingUserProfileView>('/portal/profile', { signal }),

  updateProfile: (body: ProfileUpdate) =>
    apiRequest<ParkingUserProfileView>('/portal/profile', { method: 'PATCH', body }),

  resubmitVerification: (body: VerificationResubmission) =>
    apiRequest<ParkingUserProfileView>('/portal/verification/resubmit', {
      method: 'POST',
      body,
    }),

  overview: (signal?: AbortSignal) => apiRequest<PortalOverview>('/portal/overview', { signal }),

  layout: (signal?: AbortSignal) => apiRequest<PortalLayoutResponse>('/portal/layout', { signal }),

  currentSessions: (signal?: AbortSignal) =>
    apiRequest<ParkingSessionView[]>('/portal/sessions/current', { signal }),

  session: (sessionNumber: string, signal?: AbortSignal) =>
    apiRequest<ParkingSessionView>(`/portal/sessions/${encodeURIComponent(sessionNumber)}`, {
      signal,
    }),

  vehicles: (signal?: AbortSignal) =>
    apiRequest<RegisteredVehicle[]>('/portal/vehicles', { signal }),

  addVehicle: (body: RegisterVehicleRequest) =>
    apiRequest<RegisteredVehicle>('/portal/vehicles', { method: 'POST', body }),

  updateVehicle: (id: string, body: UpdateVehicleRequest) =>
    apiRequest<RegisteredVehicle>(`/portal/vehicles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    }),

  makePrimary: (id: string) =>
    apiRequest<RegisteredVehicle>(`/portal/vehicles/${encodeURIComponent(id)}/primary`, {
      method: 'POST',
    }),

  history: (query: PortalHistoryQuery, signal?: AbortSignal) =>
    apiRequest<Page<HistoryItem>>(`/portal/history${queryString(query)}`, { signal }),

  receipts: (query: { page?: number; pageSize?: number }, signal?: AbortSignal) =>
    apiRequest<Page<ReceiptView>>(`/portal/receipts${queryString(query)}`, { signal }),

  receipt: (receiptNumber: string, signal?: AbortSignal) =>
    apiRequest<ReceiptView>(`/portal/receipts/${encodeURIComponent(receiptNumber)}`, { signal }),

  timeline: (sessionNumber: string, signal?: AbortSignal) =>
    apiRequest<SessionTimelineResponse>(
      `/portal/sessions/${encodeURIComponent(sessionNumber)}/timeline`,
      { signal },
    ),

  // --- Park now: the allocation engine proposes a slot, the user confirms it ---

  proposePark: (vehicleId: string) =>
    apiRequest<ParkProposal>('/portal/parking/proposals', { method: 'POST', body: { vehicleId } }),

  confirmPark: (body: ParkConfirmRequest) =>
    apiRequest<CheckInResponse>('/portal/parking/confirm', { method: 'POST', body }),

  cancelPark: (body: ParkCancelRequest) =>
    apiRequest<void>('/portal/parking/cancel', { method: 'POST', body }),

  // --- Self-service checkout and (simulated) payment; the server picks the exit hour ---

  checkoutQuote: (sessionNumber: string) =>
    apiRequest<CheckoutQuote>(`/portal/sessions/${encodeURIComponent(sessionNumber)}/checkout`, {
      method: 'POST',
    }),

  createPayment: (sessionNumber: string, method: PaymentMethod) =>
    apiRequest<CreatePaymentResponse>(
      `/portal/sessions/${encodeURIComponent(sessionNumber)}/payments`,
      { method: 'POST', body: { method } },
    ),

  processPayment: (paymentId: string, outcome: 'SUCCESS' | 'FAILURE' = 'SUCCESS') =>
    apiRequest<ProcessPaymentResponse>(
      `/portal/payments/${encodeURIComponent(paymentId)}/process`,
      {
        method: 'POST',
        body: { outcome },
      },
    ),

  cancelPayment: (paymentId: string) =>
    apiRequest<{ payment: PaymentView }>(
      `/portal/payments/${encodeURIComponent(paymentId)}/cancel`,
      { method: 'POST' },
    ),

  // --- Notifications ---

  notifications: (signal?: AbortSignal) =>
    apiRequest<NotificationsResponse>('/portal/notifications', { signal }),

  markNotificationRead: (id: string) =>
    apiRequest<void>(`/portal/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),

  markAllNotificationsRead: () =>
    apiRequest<void>('/portal/notifications/read-all', { method: 'POST' }),
};
