import type { ParkingUserSummary, UserRole } from '@cpvts/shared';

/** The authenticated principal attached to `req.auth`. */
export interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  tokenVersion: number;
  lastLoginAt: Date | null;
  /** Category and verification, loaded fresh on every request (null for staff and admins). */
  parkingUser: ParkingUserSummary | null;
}

export interface AuthContext {
  user: AuthenticatedUser;
}

/** Client details recorded in the audit log. */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}
