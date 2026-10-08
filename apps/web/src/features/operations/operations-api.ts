import type { AlertsResponse, SessionTimelineResponse } from '@cpvts/shared';

import { apiRequest } from '@/lib/api-client';

/** Phase 3 endpoints available to both roles. */
export const operationsApi = {
  alerts: (signal: AbortSignal) => apiRequest<AlertsResponse>('/parking/alerts', { signal }),

  timeline: (sessionNumber: string, signal: AbortSignal) =>
    apiRequest<SessionTimelineResponse>(
      `/parking/sessions/${encodeURIComponent(sessionNumber)}/timeline`,
      { signal },
    ),
};
