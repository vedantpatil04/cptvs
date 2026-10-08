import type { AuthContext } from '../modules/auth/auth.types.js';

declare global {
  namespace Express {
    interface Request {
      /** Correlation ID for logs and error responses. */
      id: string;
      /** Present only after the `authenticate` middleware succeeds. */
      auth?: AuthContext;
      /** Present only after `authenticateVisitor` succeeds: the one session the visitor may use. */
      visitor?: { sessionId: string };
    }
  }
}

export {};
