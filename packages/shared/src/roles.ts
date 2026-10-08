/**
 * Account roles.
 *
 * - `ADMIN` and `SECURITY_STAFF` are operational roles.
 * - `PARKING_USER` is a Student or Campus Staff parking user; the category and
 *   identity verification live on the server-side profile and are never taken
 *   from the client.
 *
 * Visitors never get accounts: they use a short-lived access token bound to
 * one parking session. There are no transport or bus roles.
 */
export const USER_ROLES = ['ADMIN', 'SECURITY_STAFF', 'PARKING_USER'] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Roles that operate the parking system (staff terminals and administration). */
export const OPERATIONAL_ROLES = ['ADMIN', 'SECURITY_STAFF'] as const;
export type OperationalRole = (typeof OPERATIONAL_ROLES)[number];

export const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);

export const isOperationalRole = (role: UserRole): role is OperationalRole =>
  (OPERATIONAL_ROLES as readonly string[]).includes(role);
