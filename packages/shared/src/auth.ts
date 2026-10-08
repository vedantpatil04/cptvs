import { z } from 'zod';

import type { ParkingUserCategory, VerificationStatus } from './portal.js';
import type { UserRole } from './roles.js';
import { VALIDATION_MESSAGES } from './validation.js';

export const USERNAME_MAX_LENGTH = 64;
/** Upper bound accepted on login to keep hashing cost bounded. */
export const PASSWORD_INPUT_MAX_LENGTH = 128;
/** Password policy for accounts created or changed by CPVTS. */
export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt only uses the first 72 bytes of a password; longer passwords are rejected. */
export const PASSWORD_MAX_BYTES = 72;

export const normalizeUsername = (username: string): string => username.trim().toLowerCase();

export const loginRequestSchema = z.object({
  username: z
    .string({ error: VALIDATION_MESSAGES.required })
    .trim()
    .min(1, { error: VALIDATION_MESSAGES.required })
    .max(USERNAME_MAX_LENGTH, { error: VALIDATION_MESSAGES.tooLong }),
  password: z
    .string({ error: VALIDATION_MESSAGES.required })
    .min(1, { error: VALIDATION_MESSAGES.required })
    .max(PASSWORD_INPUT_MAX_LENGTH, { error: VALIDATION_MESSAGES.tooLong }),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const passwordPolicySchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { error: VALIDATION_MESSAGES.passwordTooShort })
  .refine((value) => new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES, {
    error: VALIDATION_MESSAGES.passwordTooLong,
  });

/** Category and verification of a parking user, as decided by the server. */
export interface ParkingUserSummary {
  category: ParkingUserCategory;
  verificationStatus: VerificationStatus;
}

/** Public representation of the signed-in user. Never includes credentials. */
export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  lastLoginAt: string | null;
  /** Present only for `PARKING_USER` accounts. */
  parkingUser: ParkingUserSummary | null;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  /** ISO-8601 timestamp at which the access token expires. */
  expiresAt: string;
  user: AuthUser;
}

export interface CurrentUserResponse {
  user: AuthUser;
}
