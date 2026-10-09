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
      /**
       * Present only after `resolveOperator`: who is operating the gate. `shift` is the duty
       * shift the operation is attributed to (null for administrators and when none applies);
       * `state` says why a guard has none (ENDED = their shift ran past its end).
       */
      operator?: {
        override: boolean;
        shift: { id: string; gate: string | null } | null;
        state: 'ON_DUTY' | 'ENDED' | 'NONE';
      };
    }
  }
}

export {};
