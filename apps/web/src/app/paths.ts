import type { UserRole } from '@cpvts/shared';

export const PATHS = {
  home: '/',
  help: '/help',
  login: '/login',
  admin: {
    root: '/admin',
    account: '/admin/account',
  },
  staff: {
    root: '/staff',
    account: '/staff/account',
  },
} as const;

/** Landing page for each role after sign-in. */
export const ROLE_HOME: Record<UserRole, string> = {
  ADMIN: PATHS.admin.root,
  SECURITY_STAFF: PATHS.staff.root,
};
