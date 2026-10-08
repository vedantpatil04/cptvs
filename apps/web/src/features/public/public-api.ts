import type { PublicOverviewResponse } from '@cpvts/shared';

import { apiRequest } from '@/lib/api-client';

/** Aggregate, non-identifying parking information. No authentication. */
export const fetchPublicOverview = (signal: AbortSignal) =>
  apiRequest<PublicOverviewResponse>('/public/overview', { signal, authenticated: false });
