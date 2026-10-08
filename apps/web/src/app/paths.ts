import { RECEIPT_VERIFICATION_PATH, type UserRole } from '@cpvts/shared';

export const PATHS = {
  home: '/',
  help: '/help',
  login: '/login',
  /** Public receipt verification page (QR target). */
  verify: `${RECEIPT_VERIFICATION_PATH}/:reference`,
  admin: {
    root: '/admin',
    account: '/admin/account',
    live: '/admin/live',
    finder: '/admin/finder',
    session: '/admin/sessions/:sessionNumber',
    receipt: '/admin/receipts/:receiptNumber',
    slots: '/admin/slots',
    history: '/admin/history',
    analytics: '/admin/analytics',
    reports: '/admin/reports',
    integrity: '/admin/integrity',
    auditLogs: '/admin/audit-logs',
  },
  staff: {
    root: '/staff',
    account: '/staff/account',
    entry: '/staff/entry',
    exit: '/staff/exit',
    live: '/staff/live',
    finder: '/staff/finder',
    session: '/staff/sessions/:sessionNumber',
    receipt: '/staff/receipts/:receiptNumber',
  },
} as const;

/** Landing page for each role after sign-in. */
export const ROLE_HOME: Record<UserRole, string> = {
  ADMIN: PATHS.admin.root,
  SECURITY_STAFF: PATHS.staff.root,
};

/** Links into the signed-in user's own area (pages shared by both roles). */
export const areaPaths = (role: UserRole) => {
  const root = ROLE_HOME[role];
  return {
    root,
    live: (slotCode?: string) =>
      `${root}/live${slotCode ? `?slot=${encodeURIComponent(slotCode)}` : ''}`,
    finder: (query?: string) => `${root}/finder${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    session: (sessionNumber: string) => `${root}/sessions/${encodeURIComponent(sessionNumber)}`,
    receipt: (receiptNumber: string) => `${root}/receipts/${encodeURIComponent(receiptNumber)}`,
  };
};

/** Security Staff checkout, optionally pre-filled with a session. */
export const exitPath = (sessionNumber?: string) =>
  `${PATHS.staff.exit}${sessionNumber ? `?session=${encodeURIComponent(sessionNumber)}` : ''}`;

/** Absolute URL encoded in a receipt QR code. */
export const receiptVerificationUrl = (reference: string) =>
  `${window.location.origin}${RECEIPT_VERIFICATION_PATH}/${reference}`;
