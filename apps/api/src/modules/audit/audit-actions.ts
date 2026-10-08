/** Audit log action identifiers. Add new actions here as modules are built. */
export const AUDIT_ACTIONS = {
  authLoginSucceeded: 'AUTH_LOGIN_SUCCEEDED',
  authLoginFailed: 'AUTH_LOGIN_FAILED',
  authLogout: 'AUTH_LOGOUT',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Entity types referenced by audit log entries. */
export const AUDIT_ENTITY_TYPES = {
  user: 'USER',
} as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES];
