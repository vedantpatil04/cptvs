import type {
  AuthUser,
  LoginRequest,
  LoginResponse,
  ParkingUserCategory,
  RegistrationRequest,
  StudentRegistrationRequest,
  UserLoginRequest,
} from '@cpvts/shared';
import { createContext } from 'react';

/** Why the user is looking at the sign-in page, if not a fresh visit. */
export type SignedOutReason = 'expired' | 'signedOut';

export type AuthState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unauthenticated'; reason: SignedOutReason | null }
  | { status: 'authenticated'; user: AuthUser; expiresAt: string };

export interface AuthContextValue {
  state: AuthState;
  login: (credentials: LoginRequest) => Promise<AuthUser>;
  userLogin: (credentials: UserLoginRequest) => Promise<AuthUser>;
  register: (
    category: ParkingUserCategory,
    data: StudentRegistrationRequest | RegistrationRequest,
  ) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** Re-attempts session restoration after a network failure. */
  retry: () => void;
  /** Refreshes current user profile (e.g. after verification decision/resubmission). */
  refreshUser: () => Promise<AuthUser | null>;
  setSession: (response: LoginResponse) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
