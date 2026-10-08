import type { UserRole } from '@cpvts/shared';

/** The authenticated principal attached to `req.auth`. */
export interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  tokenVersion: number;
  lastLoginAt: Date | null;
}

export interface AuthContext {
  user: AuthenticatedUser;
}

/** Client details recorded in the audit log. */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}
