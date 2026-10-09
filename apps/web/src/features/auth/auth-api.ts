import type {
  CurrentUserResponse,
  LoginRequest,
  LoginResponse,
  RegistrationRequest,
  StudentRegistrationRequest,
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

  registerStudent: (data: StudentRegistrationRequest) =>
    apiRequest<LoginResponse>('/auth/register/student', {
      method: 'POST',
      body: data,
      authenticated: false,
    }),

  registerStaff: (data: RegistrationRequest) =>
    apiRequest<LoginResponse>('/auth/register/staff', {
      method: 'POST',
      body: data,
      authenticated: false,
    }),

  logout: () => apiRequest<void>('/auth/logout', { method: 'POST' }),

  me: (signal?: AbortSignal) => apiRequest<CurrentUserResponse>('/auth/me', { signal }),
};
