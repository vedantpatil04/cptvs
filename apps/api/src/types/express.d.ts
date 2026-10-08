import type { AuthContext } from '../modules/auth/auth.types.js';

declare global {
  namespace Express {
    interface Request {
      /** Correlation ID for logs and error responses. */
      id: string;
      /** Present only after the `authenticate` middleware succeeds. */
      auth?: AuthContext;
      /** Present only after `authenticateVisitor`: the one session a visitor may see. */
      visitor?: { sessionId: string };
    }
  }
}

export {};
