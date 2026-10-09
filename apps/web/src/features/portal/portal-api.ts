import type {
  CheckoutQuote,
  CreatePaymentResponse,
  CurrentParkNowOfferResponse,
  ExitRequestState,
  HistoryItem,
  MOCK_PAYMENT_OUTCOMES,
  NotificationView,
  NotificationsResponse,
  Page,
  ParkNowConfirmation,
  ParkNowOffer,
  ParkingSessionView,
  ParkingUserProfileView,
  PaymentMethod,
  PaymentView,
  PortalHistoryQuery,
  PortalLayoutResponse,
  PortalOverview,
  ProcessPaymentResponse,
  ProfileUpdate,
  ReceiptView,
  RegisterVehicleRequest,
  RegisteredVehicle,
  UpdateVehicleRequest,
  VehiclesResponse,
  VerificationResubmission,
} from '@cpvts/shared';

import { apiRequest } from '@/lib/api-client';

type MockPaymentOutcome = (typeof MOCK_PAYMENT_OUTCOMES)[number];

export const portalApi = {
  overview: () => apiRequest<PortalOverview>('/portal/overview'),

  layout: () => apiRequest<PortalLayoutResponse>('/portal/layout'),

  profile: () => apiRequest<ParkingUserProfileView>('/portal/profile'),

  updateProfile: (data: ProfileUpdate) =>
    apiRequest<ParkingUserProfileView>('/portal/profile', { method: 'PATCH', body: data }),

  resubmitVerification: (data: VerificationResubmission) =>
    apiRequest<ParkingUserProfileView>('/portal/verification/resubmit', {
      method: 'POST',
      body: data,
    }),

  notifications: (query?: { unreadOnly?: boolean; limit?: number }) => {
    const params = new URLSearchParams();
    if (query?.unreadOnly) params.set('unreadOnly', 'true');
    if (query?.limit) params.set('limit', String(query.limit));
    const qs = params.toString();
    return apiRequest<NotificationsResponse>(`/portal/notifications${qs ? `?${qs}` : ''}`);
  },

  markNotificationRead: (id: string) =>
    apiRequest<NotificationView>(`/portal/notifications/${id}/read`, { method: 'POST' }),

  markAllNotificationsRead: () =>
    apiRequest<{ readCount: number }>('/portal/notifications/read-all', { method: 'POST' }),

  vehicles: () => apiRequest<VehiclesResponse>('/portal/vehicles'),

  registerVehicle: (data: RegisterVehicleRequest) =>
    apiRequest<RegisteredVehicle>('/portal/vehicles', { method: 'POST', body: data }),

  updateVehicle: (id: string, data: UpdateVehicleRequest) =>
    apiRequest<RegisteredVehicle>(`/portal/vehicles/${id}`, { method: 'PATCH', body: data }),

  setPrimaryVehicle: (id: string) =>
    apiRequest<RegisteredVehicle>(`/portal/vehicles/${id}/primary`, { method: 'POST' }),

  currentOffer: () => apiRequest<CurrentParkNowOfferResponse>('/portal/park-now/offer'),

  startParkNow: (vehicleId: string) =>
    apiRequest<ParkNowOffer>('/portal/park-now/offers', {
      method: 'POST',
      body: { vehicleId },
    }),

  confirmParkNow: (offerId: string) =>
    apiRequest<ParkNowConfirmation>('/portal/park-now/confirm', {
      method: 'POST',
      body: { offerId },
    }),

  cancelParkNow: (offerId: string) =>
    apiRequest<void>('/portal/park-now/cancel', {
      method: 'POST',
      body: { offerId },
    }),

  activeSessions: () =>
    apiRequest<{ sessions: ParkingSessionView[] }>('/portal/sessions/active'),

  session: (sessionNumber: string) =>
    apiRequest<ParkingSessionView>(`/portal/sessions/${encodeURIComponent(sessionNumber)}`),

  timeline: (sessionNumber: string) =>
    apiRequest<{ sessionNumber: string; events: unknown[] }>(
      `/portal/sessions/${encodeURIComponent(sessionNumber)}/timeline`,
    ),

  quoteCheckout: (sessionNumber: string) =>
    apiRequest<CheckoutQuote>('/portal/checkout/quote', {
      method: 'POST',
      body: { sessionNumber },
    }),

  requestExit: (sessionNumber: string) =>
    apiRequest<ExitRequestState>(
      `/portal/sessions/${encodeURIComponent(sessionNumber)}/exit-request`,
      { method: 'POST' },
    ),

  cancelExitRequest: (sessionNumber: string) =>
    apiRequest<ExitRequestState>(
      `/portal/sessions/${encodeURIComponent(sessionNumber)}/exit-request`,
      { method: 'DELETE' },
    ),

  createPayment: (sessionNumber: string, method: PaymentMethod) =>
    apiRequest<CreatePaymentResponse>('/portal/checkout/payments', {
      method: 'POST',
      body: { sessionNumber, method },
    }),

  processPayment: (
    paymentId: string,
    sessionNumber: string,
    outcome: MockPaymentOutcome = 'SUCCESS',
  ) =>
    apiRequest<ProcessPaymentResponse>(`/portal/checkout/payments/${paymentId}/process`, {
      method: 'POST',
      body: { sessionNumber, outcome },
    }),

  cancelPayment: (paymentId: string, sessionNumber: string) =>
    apiRequest<{ payment: PaymentView }>(`/portal/checkout/payments/${paymentId}/cancel`, {
      method: 'POST',
      body: { sessionNumber },
    }),

  history: (query?: PortalHistoryQuery) => {
    const params = new URLSearchParams();
    if (query?.page) params.set('page', String(query.page));
    if (query?.pageSize) params.set('pageSize', String(query.pageSize));
    if (query?.vehicleNumber) params.set('vehicleNumber', String(query.vehicleNumber));
    if (query?.vehicleType) params.set('vehicleType', String(query.vehicleType));
    if (query?.from) params.set('from', String(query.from));
    if (query?.to) params.set('to', String(query.to));
    const qs = params.toString();
    return apiRequest<Page<HistoryItem>>(`/portal/history${qs ? `?${qs}` : ''}`);
  },

  receipts: (query?: { page?: number; pageSize?: number }) => {
    const params = new URLSearchParams();
    if (query?.page) params.set('page', String(query.page));
    if (query?.pageSize) params.set('pageSize', String(query.pageSize));
    const qs = params.toString();
    return apiRequest<Page<ReceiptView>>(`/portal/receipts${qs ? `?${qs}` : ''}`);
  },

  receipt: (receiptNumber: string) =>
    apiRequest<ReceiptView>(`/portal/receipts/${encodeURIComponent(receiptNumber)}`),
};
