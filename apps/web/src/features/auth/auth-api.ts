import type {
  CurrentUserResponse,
  LoginRequest,
  LoginResponse,
  ParkingUserCategory,
  RegistrationRequest,
  UserLoginRequest,
} from '@cpvts/shared';

import { apiRequest } from '@/lib/api-client';

export const authApi = {
  login: (credentials: LoginRequest) =>
    apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: credentials,
      authenticated: false,
    }),

  userLogin: (credentials: UserLoginRequest) =>
    apiRequest<LoginResponse>('/auth/user-login', {
      method: 'POST',
      body: credentials,
      authenticated: false,
    }),

  register: (category: ParkingUserCategory, body: RegistrationRequest) =>
    apiRequest<LoginResponse>(`/auth/register/${category.toLowerCase()}`, {
      method: 'POST',
      body,
      authenticated: false,
    }),

  logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),

  me: (signal?: AbortSignal) => apiRequest<CurrentUserResponse>('/auth/me', { signal }),
};
