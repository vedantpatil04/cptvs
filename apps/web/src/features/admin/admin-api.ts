import type {
  AdminUserUpdate,
  AnalyticsResponse,
  AuditLogEntry,
  AuditLogQuery,
  CreateSlotRequest,
  HistoryItem,
  HistoryQuery,
  IntegrityReport,
  LayoutQuery,
  ManagedLayout,
  ManagedSlot,
  Page,
  ParkingBlockSummary,
  ReportKind,
  SendNoticeRequest,
  SendNoticeResponse,
  SlotDeletionResult,
  UpdateSlotRequest,
  UserCounts,
  UserDetail,
  UserListItem,
  UserListQuery,
  VerificationDecision,
} from '@cpvts/shared';

import { apiDownload, apiRequest } from '@/lib/api-client';

/** Builds `?a=1&b=2` from string and number values, leaving out empty ones. */
export const queryString = (values: object): string => {
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

const slotPath = (code: string) => `/admin/slots/${encodeURIComponent(code)}`;

/** Administrator management endpoints (Phase 3 + Phase 4). */
export const adminApi = {
  layout: (signal?: AbortSignal, query?: LayoutQuery) =>
    apiRequest<ManagedLayout>(`/admin/layout${queryString(query || {})}`, { signal }),

  createSlot: (data: CreateSlotRequest) =>
    apiRequest<ManagedSlot>('/admin/slots', { method: 'POST', body: data }),

  updateSlot: (code: string, data: UpdateSlotRequest) =>
    apiRequest<ManagedSlot>(slotPath(code), { method: 'PATCH', body: data }),

  deleteSlot: (code: string) =>
    apiRequest<SlotDeletionResult>(slotPath(code), { method: 'DELETE' }),

  archiveSlot: (code: string) =>
    apiRequest<SlotDeletionResult>(`${slotPath(code)}/archive`, { method: 'POST' }),

  restoreSlot: (code: string) =>
    apiRequest<ManagedSlot>(`${slotPath(code)}/restore`, { method: 'POST' }),

  enableSlot: (code: string) =>
    apiRequest<ManagedSlot>(`${slotPath(code)}/enable`, { method: 'POST' }),

  disableSlot: (code: string) =>
    apiRequest<ManagedSlot>(`${slotPath(code)}/disable`, { method: 'POST' }),

  blockSlot: (code: string, reason: string) =>
    apiRequest<ManagedSlot>(`${slotPath(code)}/block`, { method: 'POST', body: { reason } }),

  unblockSlot: (code: string) =>
    apiRequest<ManagedSlot>(`${slotPath(code)}/unblock`, { method: 'POST' }),

  setSlotPriority: (code: string, priority: number) =>
    apiRequest<ManagedSlot>(`${slotPath(code)}/priority`, {
      method: 'PATCH',
      body: { priority },
    }),

  setBlockLocation: (code: string, latitude: number | null, longitude: number | null) =>
    apiRequest<ParkingBlockSummary>(`/admin/blocks/${encodeURIComponent(code)}/location`, {
      method: 'PATCH',
      body: { latitude, longitude },
    }),

  users: (query?: UserListQuery, signal?: AbortSignal) =>
    apiRequest<Page<UserListItem>>(`/admin/users${queryString(query || {})}`, { signal }),

  userCounts: (signal?: AbortSignal) =>
    apiRequest<UserCounts>('/admin/users/counts', { signal }),

  userDetail: (id: string, signal?: AbortSignal) =>
    apiRequest<UserDetail>(`/admin/users/${encodeURIComponent(id)}`, { signal }),

  updateUser: (id: string, data: AdminUserUpdate) =>
    apiRequest<UserDetail>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: data,
    }),

  setUserStatus: (id: string, isActive: boolean) =>
    apiRequest<UserDetail>(`/admin/users/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: { isActive },
    }),

  decideVerification: (id: string, data: VerificationDecision) =>
    apiRequest<UserDetail>(`/admin/users/${encodeURIComponent(id)}/verification`, {
      method: 'POST',
      body: data,
    }),

  userHistory: (id: string, page = 1, pageSize = 25, signal?: AbortSignal) =>
    apiRequest<Page<HistoryItem>>(
      `/admin/users/${encodeURIComponent(id)}/history${queryString({ page, pageSize })}`,
      { signal },
    ),

  downloadDocument: (userId: string, documentId: string) =>
    apiDownload(
      `/admin/users/${encodeURIComponent(userId)}/documents/${encodeURIComponent(documentId)}`,
    ),

  visitors: (query?: HistoryQuery, signal?: AbortSignal) =>
    apiRequest<Page<HistoryItem>>(`/admin/visitors${queryString(query || {})}`, { signal }),

  sendNotice: (data: SendNoticeRequest) =>
    apiRequest<SendNoticeResponse>('/admin/notices', { method: 'POST', body: data }),

  history: (query: HistoryQuery, signal?: AbortSignal) =>
    apiRequest<Page<HistoryItem>>(`/admin/history${queryString(query)}`, { signal }),

  analytics: (date: string | undefined, signal?: AbortSignal) =>
    apiRequest<AnalyticsResponse>(`/admin/analytics${queryString({ date })}`, { signal }),

  integrity: (signal?: AbortSignal) =>
    apiRequest<IntegrityReport>('/admin/integrity', { signal }),

  auditLogs: (query: AuditLogQuery, signal?: AbortSignal) =>
    apiRequest<Page<AuditLogEntry>>(`/admin/audit-logs${queryString(query)}`, { signal }),

  downloadReport: (kind: ReportKind, range: { from?: string; to?: string }) =>
    apiDownload(`/admin/reports/${kind}${queryString(range)}`),
};

