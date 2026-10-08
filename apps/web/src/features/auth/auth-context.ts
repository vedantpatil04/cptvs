import type { AuthUser, LoginRequest } from '@cpvts/shared';
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
  logout: () => Promise<void>;
  /** Re-attempts session restoration after a network failure. */
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
