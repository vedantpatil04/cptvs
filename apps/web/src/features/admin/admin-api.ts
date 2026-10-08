import type {
  AnalyticsResponse,
  AuditLogEntry,
  AuditLogQuery,
  HistoryItem,
  HistoryQuery,
  IntegrityReport,
  ManagedLayout,
  ManagedSlot,
  Page,
  ParkingBlockSummary,
  ReportKind,
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
};
