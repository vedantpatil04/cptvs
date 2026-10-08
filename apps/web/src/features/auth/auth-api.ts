import type { CurrentUserResponse, LoginRequest, LoginResponse } from '@cpvts/shared';

import { apiRequest } from '@/lib/api-client';

export const authApi = {
  login: (credentials: LoginRequest) =>
    apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: credentials,
      authenticated: false,
    }),

  logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),

  me: (signal?: AbortSignal) => apiRequest<CurrentUserResponse>('/auth/me', { signal }),
};
