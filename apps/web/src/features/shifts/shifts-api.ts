import type {
  CashHandoverRequest,
  CashHandoverView,
  CashSummaryQuery,
  CashSummaryResponse,
  CreateSecurityStaffRequest,
  CreateShiftRequest,
  CreateShiftTemplateRequest,
  MyShiftResponse,
  ResetPasswordRequest,
  ResolveDiscrepancyRequest,
  RosterResponse,
  SecurityStaffMember,
  ShiftListQuery,
  ShiftTemplateView,
  ShiftTransactionView,
  ShiftView,
  UpdateShiftTemplateRequest,
} from '@cpvts/shared';

import { apiRequest } from '@/lib/api-client';

const queryString = (values: object): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (
      (typeof value === 'string' && value !== '') ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
};

export const securityShiftApi = {
  mine: (signal?: AbortSignal) =>
    apiRequest<MyShiftResponse>('/security/shift', { signal }),

  checkIn: (shiftId?: string) =>
    apiRequest<ShiftView>('/security/shift/check-in', {
      method: 'POST',
      body: shiftId ? { shiftId } : {},
    }),

  checkOut: () =>
    apiRequest<ShiftView>('/security/shift/check-out', {
      method: 'POST',
    }),
};

export const adminShiftsApi = {
  securityStaff: (signal?: AbortSignal) =>
    apiRequest<SecurityStaffMember[]>('/admin/security-staff', { signal }),

  createSecurityStaff: (data: CreateSecurityStaffRequest) =>
    apiRequest<SecurityStaffMember>('/admin/security-staff', {
      method: 'POST',
      body: data,
    }),

  resetStaffPassword: (id: string, data: ResetPasswordRequest) =>
    apiRequest<void>(`/admin/security-staff/${encodeURIComponent(id)}/password`, {
      method: 'POST',
      body: data,
    }),

  templates: (query?: { includeInactive?: boolean }, signal?: AbortSignal) =>
    apiRequest<ShiftTemplateView[]>(`/admin/shift-templates${queryString(query || {})}`, {
      signal,
    }),

  createTemplate: (data: CreateShiftTemplateRequest) =>
    apiRequest<ShiftTemplateView>('/admin/shift-templates', {
      method: 'POST',
      body: data,
    }),

  updateTemplate: (id: string, data: UpdateShiftTemplateRequest) =>
    apiRequest<ShiftTemplateView>(`/admin/shift-templates/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: data,
    }),

  roster: (date: string, signal?: AbortSignal) =>
    apiRequest<RosterResponse>(`/admin/shifts/roster${queryString({ date })}`, { signal }),

  list: (query?: ShiftListQuery, signal?: AbortSignal) =>
    apiRequest<ShiftView[]>(`/admin/shifts${queryString(query || {})}`, { signal }),

  get: (id: string, signal?: AbortSignal) =>
    apiRequest<ShiftView>(`/admin/shifts/${encodeURIComponent(id)}`, { signal }),

  assign: (data: CreateShiftRequest) =>
    apiRequest<ShiftView>('/admin/shifts', {
      method: 'POST',
      body: data,
    }),

  cancel: (id: string) =>
    apiRequest<void>(`/admin/shifts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  adminCheckOut: (id: string) =>
    apiRequest<ShiftView>(`/admin/shifts/${encodeURIComponent(id)}/check-out`, {
      method: 'POST',
    }),

  transactions: (id: string, signal?: AbortSignal) =>
    apiRequest<ShiftTransactionView[]>(`/admin/shifts/${encodeURIComponent(id)}/transactions`, {
      signal,
    }),

  recordHandover: (id: string, data: CashHandoverRequest) =>
    apiRequest<CashHandoverView>(`/admin/shifts/${encodeURIComponent(id)}/handover`, {
      method: 'POST',
      body: data,
    }),

  resolveDiscrepancy: (id: string, data: ResolveDiscrepancyRequest) =>
    apiRequest<CashHandoverView>(`/admin/shifts/${encodeURIComponent(id)}/handover/resolve`, {
      method: 'POST',
      body: data,
    }),

  cashSummary: (query?: CashSummaryQuery, signal?: AbortSignal) =>
    apiRequest<CashSummaryResponse>(`/admin/cash/summary${queryString(query || {})}`, { signal }),

  cashDiscrepancies: (signal?: AbortSignal) =>
    apiRequest<ShiftView[]>('/admin/cash/discrepancies', { signal }),
};
