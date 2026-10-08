/**
 * CPVTS has exactly two authenticated roles. Do not add Student, Visitor,
 * Transport Staff or Bus Driver logins (see Master Blueprint §3).
 */
export const USER_ROLES = ['ADMIN', 'SECURITY_STAFF'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
