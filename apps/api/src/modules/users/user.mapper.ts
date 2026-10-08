import type { AuthUser, UserRole as SharedUserRole } from '@cpvts/shared';

import type { User, UserRole as DbUserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

// Compile-time guarantee that the database enum and the shared contract agree.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const rolesMatch: Equals<DbUserRole, SharedUserRole> = true;
void rolesMatch;

export const toAuthenticatedUser = (user: User): AuthenticatedUser => ({
  id: user.id,
  username: user.username,
  fullName: user.fullName,
  role: user.role,
  tokenVersion: user.tokenVersion,
  lastLoginAt: user.lastLoginAt,
});

/** Public, credential-free representation returned by the API. */
export const toAuthUser = (user: AuthenticatedUser): AuthUser => ({
  id: user.id,
  username: user.username,
  fullName: user.fullName,
  role: user.role,
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
});
