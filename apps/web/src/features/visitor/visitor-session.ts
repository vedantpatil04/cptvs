import { createContext, useContext } from 'react';

/**
 * A visitor's short-lived access to ONE parking session. Kept in
 * sessionStorage (cleared when the tab closes) and never mixed with the
 * account session used by Students, Staff, Security and Admin.
 */
const STORAGE_KEY = 'cpvts.visitor';

export interface VisitorSession {
  accessToken: string;
  expiresAt: string;
}

const isVisitorSession = (value: unknown): value is VisitorSession =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as VisitorSession).accessToken === 'string' &&
  typeof (value as VisitorSession).expiresAt === 'string';

export const visitorStore = {
  read(): VisitorSession | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (!isVisitorSession(parsed) || Date.parse(parsed.expiresAt) <= Date.now()) {
        sessionStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },
  write(session: VisitorSession): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Storage can be unavailable (private mode, WebView restrictions); access then lasts for this page only.
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  },
};

export interface VisitorContextValue {
  session: VisitorSession | null;
  start: (session: VisitorSession) => void;
  end: () => void;
}

export const VisitorContext = createContext<VisitorContextValue | null>(null);

export const useVisitor = (): VisitorContextValue => {
  const context = useContext(VisitorContext);
  if (!context) throw new Error('useVisitor must be used within the visitor area');
  return context;
};
