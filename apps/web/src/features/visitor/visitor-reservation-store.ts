const KEY = 'cpvts_visitor_reservation';

interface Stored {
  token: string;
  expiresAt: string;
}

/**
 * The visitor's reservation token. It lives in localStorage (not sessionStorage) so that closing
 * and reopening the browser or the Android app brings the visitor straight back to their pass.
 * The token reaches one reservation only and expires on its own.
 */
export const visitorReservationStore = {
  get: (): string | null => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as Partial<Stored>;
      if (
        typeof stored.token !== 'string' ||
        typeof stored.expiresAt !== 'string' ||
        Date.parse(stored.expiresAt) <= Date.now()
      ) {
        localStorage.removeItem(KEY);
        return null;
      }
      return stored.token;
    } catch {
      return null;
    }
  },
  set: (token: string, expiresAt: string): void => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ token, expiresAt } satisfies Stored));
    } catch {
      // Storage may be unavailable (private mode); the pass is then only kept in memory.
    }
  },
  clear: (): void => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Ignore
    }
  },
};
