import type {
  AuthUser,
  LoginRequest,
  ParkingUserCategory,
  RegistrationRequest,
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
  /** Administrator / Security Staff sign-in (username + password). */
  login: (credentials: LoginRequest) => Promise<AuthUser>;
  /** Student / Campus Staff sign-in (e-mail + password). */
  loginUser: (credentials: UserLoginRequest) => Promise<AuthUser>;
  /** Creates a Student or Campus Staff account and signs it in (verification stays pending). */
  registerUser: (category: ParkingUserCategory, body: RegistrationRequest) => Promise<AuthUser>;
  /** Reloads the signed-in user (e.g. after an administrator decides a verification). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** Re-attempts session restoration after a network failure. */
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
