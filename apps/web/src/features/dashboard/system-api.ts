import type { SystemStatusResponse } from '@cpvts/shared';

import { apiRequest } from '@/lib/api-client';

export const fetchSystemStatus = (signal: AbortSignal) =>
  apiRequest<SystemStatusResponse>('/system/status', { signal });
