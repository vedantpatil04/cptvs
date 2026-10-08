import type {
  AuthUser,
  ParkingUserCategory as SharedCategory,
  UserRole as SharedUserRole,
  VerificationStatus as SharedVerificationStatus,
} from '@cpvts/shared';

import type {
  ParkingUserCategory as DbCategory,
  UserRole as DbUserRole,
  VerificationStatus as DbVerificationStatus,
} from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { UserWithProfile } from './user.repository.js';

// Compile-time guarantee that the database enums and the shared contract agree.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const enumsMatch: [
  Equals<DbUserRole, SharedUserRole>,
  Equals<DbCategory, SharedCategory>,
  Equals<DbVerificationStatus, SharedVerificationStatus>,
] = [true, true, true];
void enumsMatch;

export const toAuthenticatedUser = (user: UserWithProfile): AuthenticatedUser => ({
  id: user.id,
  username: user.username,
  fullName: user.fullName,
  role: user.role,
  tokenVersion: user.tokenVersion,
  lastLoginAt: user.lastLoginAt,
  parkingUser: user.parkingProfile
    ? {
        category: user.parkingProfile.category,
        verificationStatus: user.parkingProfile.verificationStatus,
      }
    : null,
});

/** Public, credential-free representation returned by the API. */
export const toAuthUser = (user: AuthenticatedUser): AuthUser => ({
  id: user.id,
  username: user.username,
  fullName: user.fullName,
  role: user.role,
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  parkingUser: user.parkingUser,
});
