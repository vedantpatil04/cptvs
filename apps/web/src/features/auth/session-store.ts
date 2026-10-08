/**
 * Persists the access token so a signed-in security terminal survives a page
 * reload. The token is short-lived, revocable server-side (logout bumps the
 * user's token version) and never trusted for authorisation by the server.
 * It is sent only as an Authorization header, which works identically for the
 * website and the Android WebView without cross-site cookies.
 */
const STORAGE_KEY = 'cpvts.session';

export interface StoredSession {
  accessToken: string;
  /** ISO-8601 expiry from the server. */
  expiresAt: string;
}

const isStoredSession = (value: unknown): value is StoredSession =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as StoredSession).accessToken === 'string' &&
  typeof (value as StoredSession).expiresAt === 'string';

export const isExpired = (session: StoredSession, now = Date.now()): boolean => {
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isNaN(expiresAt) || expiresAt <= now;
};

export const sessionStore = {
  read(): StoredSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (!isStoredSession(parsed) || isExpired(parsed)) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },

  write(session: StoredSession): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // If storage is unavailable the session lasts only for this page load.
    }
  },

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  },
};
