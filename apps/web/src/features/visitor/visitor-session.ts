const VISITOR_TOKEN_KEY = 'cpvts_visitor_token';

export const visitorSessionStore = {
  get: (): string | null => {
    try {
      return sessionStorage.getItem(VISITOR_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string): void => {
    try {
      sessionStorage.setItem(VISITOR_TOKEN_KEY, token);
    } catch {
      // Ignore
    }
  },
  clear: (): void => {
    try {
      sessionStorage.removeItem(VISITOR_TOKEN_KEY);
    } catch {
      // Ignore
    }
  },
};
