import type { AuthUser } from '@cpvts/shared';
import { useContext } from 'react';

import { AuthContext, type AuthContextValue } from './auth-context';

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within <AuthProvider>');
  return context;
};

/** The signed-in user. Only call inside routes protected by `RequireAuth`. */
export const useCurrentUser = (): { user: AuthUser; expiresAt: string } => {
  const { state } = useAuth();
  if (state.status !== 'authenticated') {
    throw new Error('useCurrentUser must be used within an authenticated route');
  }
  return { user: state.user, expiresAt: state.expiresAt };
};
