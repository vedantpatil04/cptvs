import type { LoginRequest } from '@cpvts/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ApiError, configureApiClient } from '@/lib/api-client';

import { authApi } from './auth-api';
import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
  type SignedOutReason,
} from './auth-context';
import { sessionStore, type StoredSession } from './session-store';

/**
 * Owns the client-side authentication state. The server remains the source of
 * truth: on load the stored token is verified with `GET /auth/me`, and any 401
 * from the API ends the session locally.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialSession] = useState(() => sessionStore.read());
  const sessionRef = useRef<StoredSession | null>(initialSession);
  const [state, setState] = useState<AuthState>(() =>
    initialSession ? { status: 'loading' } : { status: 'unauthenticated', reason: null },
  );
  const [attempt, setAttempt] = useState(0);

  const endSession = useCallback((reason: SignedOutReason | null) => {
    sessionRef.current = null;
    sessionStore.clear();
    setState({ status: 'unauthenticated', reason });
  }, []);

  useEffect(() => {
    configureApiClient({
      getAccessToken: () => sessionRef.current?.accessToken ?? null,
      onUnauthorized: () => endSession('expired'),
    });
  }, [endSession]);

  // Verify a stored session on load (and on retry after a network failure).
  useEffect(() => {
    const stored = sessionRef.current;
    if (!stored) return;

    const controller = new AbortController();
    authApi
      .me(controller.signal)
      .then(({ user }) => setState({ status: 'authenticated', user, expiresAt: stored.expiresAt }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) endSession('expired');
        else setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [attempt, endSession]);

  // End the session locally when the token expires.
  const expiresAt = state.status === 'authenticated' ? state.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(
      () => endSession('expired'),
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [expiresAt, endSession]);

  const login = useCallback(async (credentials: LoginRequest) => {
    const result = await authApi.login(credentials);
    const session = { accessToken: result.accessToken, expiresAt: result.expiresAt };
    sessionRef.current = session;
    sessionStore.write(session);
    setState({ status: 'authenticated', user: result.user, expiresAt: result.expiresAt });
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The local session is cleared regardless; the token also expires on its own.
    } finally {
      endSession('signedOut');
    }
  }, [endSession]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, login, logout, retry }),
    [state, login, logout, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
