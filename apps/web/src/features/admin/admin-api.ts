import type {
  AnalyticsResponse,
  AuditLogEntry,
  AuditLogQuery,
  HistoryItem,
  CreateSlotRequest,
  DeleteSlotResponse,
  HistoryQuery,
  IntegrityReport,
  ManagedBlock,
  ManagedLayout,
  ManagedSlot,
  ManagedZone,
  NextSlotCodeResponse,
  Page,
  ParkingBlockSummary,
  PortalHistoryQuery,
  ReceiptView,
  ReportKind,
  UpdateBlockRequest,
  UpdateSlotRequest,
  UpdateZoneRequest,
  AdminUserUpdate,
  UserCounts,
  UserDetail,
  UserListItem,
  UserListQuery,
  VerificationDecision,
  VisitorListItem,
  VisitorListQuery,
} from '@cpvts/shared';

import { apiDownload, apiRequest } from '@/lib/api-client';

/** Builds `?a=1&b=2` from string and number values, leaving out empty ones. */
export const queryString = (values: object): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if ((typeof value === 'string' && value !== '') || typeof value === 'number') {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
};

const slotPath = (code: string) => `/admin/slots/${encodeURIComponent(code)}`;

/** Administrator management endpoints (Phase 3). */
export const adminApi = {
  layout: (signal: AbortSignal) => apiRequest<ManagedLayout>('/admin/layout', { signal }),

  blockSlot: (code: string, reason: string) =>
    apiRequest<ManagedSlot>(`${slotPath(code)}/block`, { method: 'POST', body: { reason } }),

  unblockSlot: (code: string) =>
    apiRequest<ManagedSlot>(`${slotPath(code)}/unblock`, { method: 'POST' }),

  setSlotPriority: (code: string, priority: number) =>
    apiRequest<ManagedSlot>(`${slotPath(code)}/priority`, {
      method: 'PATCH',
      body: { priority },
    }),

  createSlot: (body: CreateSlotRequest) =>
    apiRequest<ManagedSlot>('/admin/slots', { method: 'POST', body }),

  nextSlotCode: (zoneCode: string, signal?: AbortSignal) =>
    apiRequest<NextSlotCodeResponse>(
      `/admin/zones/${encodeURIComponent(zoneCode)}/next-slot-code`,
      { signal },
    ),

  updateSlot: (code: string, body: UpdateSlotRequest) =>
    apiRequest<ManagedSlot>(slotPath(code), { method: 'PATCH', body }),

  enableSlot: (code: string) =>
    apiRequest<ManagedSlot>(`${slotPath(code)}/enable`, { method: 'POST' }),

  disableSlot: (code: string) =>
    apiRequest<ManagedSlot>(`${slotPath(code)}/disable`, { method: 'POST' }),

  /** Removes a slot that was never used; archives one that has parking history. */
  deleteSlot: (code: string) =>
    apiRequest<DeleteSlotResponse>(slotPath(code), { method: 'DELETE' }),

  updateBlock: (code: string, body: UpdateBlockRequest) =>
    apiRequest<ManagedBlock>(`/admin/blocks/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      body,
    }),

  updateZone: (code: string, body: UpdateZoneRequest) =>
    apiRequest<ManagedZone>(`/admin/zones/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      body,
    }),

  setBlockLocation: (code: string, latitude: number | null, longitude: number | null) =>
    apiRequest<ParkingBlockSummary>(`/admin/blocks/${encodeURIComponent(code)}/location`, {
      method: 'PATCH',
      body: { latitude, longitude },
    }),

  history: (query: HistoryQuery, signal: AbortSignal) =>
    apiRequest<Page<HistoryItem>>(`/admin/history${queryString(query)}`, { signal }),

  analytics: (date: string | undefined, signal: AbortSignal) =>
    apiRequest<AnalyticsResponse>(`/admin/analytics${queryString({ date })}`, { signal }),

  integrity: (signal: AbortSignal) => apiRequest<IntegrityReport>('/admin/integrity', { signal }),

  auditLogs: (query: AuditLogQuery, signal: AbortSignal) =>
    apiRequest<Page<AuditLogEntry>>(`/admin/audit-logs${queryString(query)}`, { signal }),

  downloadReport: (kind: ReportKind, range: { from?: string; to?: string }) =>
    apiDownload(`/admin/reports/${kind}${queryString(range)}`),

  userCounts: (signal: AbortSignal) => apiRequest<UserCounts>('/admin/users/counts', { signal }),

  users: (query: UserListQuery, signal: AbortSignal) =>
    apiRequest<Page<UserListItem>>(`/admin/users${queryString(query)}`, { signal }),

  visitors: (query: VisitorListQuery, signal: AbortSignal) =>
    apiRequest<Page<VisitorListItem>>(`/admin/visitors${queryString(query)}`, { signal }),

  user: (id: string, signal?: AbortSignal) =>
    apiRequest<UserDetail>(`/admin/users/${encodeURIComponent(id)}`, { signal }),

  updateUser: (id: string, body: AdminUserUpdate) =>
    apiRequest<UserDetail>(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body }),

  setUserActive: (id: string, isActive: boolean) =>
    apiRequest<UserDetail>(`/admin/users/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: { isActive },
    }),

  decideVerification: (id: string, body: VerificationDecision) =>
    apiRequest<UserDetail>(`/admin/users/${encodeURIComponent(id)}/verification`, {
      method: 'POST',
      body,
    }),

  userHistory: (id: string, query: PortalHistoryQuery, signal?: AbortSignal) =>
    apiRequest<Page<HistoryItem>>(
      `/admin/users/${encodeURIComponent(id)}/history${queryString(query)}`,
      { signal },
    ),

  userReceipts: (id: string, query: { page?: number; pageSize?: number }, signal?: AbortSignal) =>
    apiRequest<Page<ReceiptView>>(
      `/admin/users/${encodeURIComponent(id)}/receipts${queryString(query)}`,
      { signal },
    ),

  /** Fetches an identity document with the administrator's credentials (never a public URL). */
  identityDocument: (userId: string, documentId: string) =>
    apiDownload(
      `/admin/users/${encodeURIComponent(userId)}/documents/${encodeURIComponent(documentId)}`,
    ),
};
