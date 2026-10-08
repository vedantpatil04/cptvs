import { RECEIPT_VERIFICATION_PATH, type UserRole } from '@cpvts/shared';

export const PATHS = {
  home: '/',
  help: '/help',
  /** Administrator / Security Staff sign-in. */
  login: '/login',
  /** Student / Campus Staff sign-in. */
  userLogin: '/user/login',
  register: '/register/:category',
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
    users: '/admin/users',
    user: '/admin/users/:userId',
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
  user: {
    root: '/user',
    myParking: '/user/my-parking',
    locate: '/user/locate',
    vehicles: '/user/vehicles',
    availability: '/user/parking',
    history: '/user/history',
    session: '/user/sessions/:sessionNumber',
    receipts: '/user/receipts',
    receipt: '/user/receipts/:receiptNumber',
    profile: '/user/profile',
    more: '/user/more',
  },
  visitor: {
    root: '/visitor',
    parking: '/visitor/parking',
    receipt: '/visitor/receipt',
  },
} as const;

/** Links inside the Student / Campus Staff area. */
export const userPaths = {
  session: (sessionNumber: string) =>
    `${PATHS.user.root}/sessions/${encodeURIComponent(sessionNumber)}`,
  receipt: (receiptNumber: string, print = false) =>
    `${PATHS.user.root}/receipts/${encodeURIComponent(receiptNumber)}${print ? '?print=1' : ''}`,
  locate: (sessionNumber?: string) =>
    `${PATHS.user.locate}${sessionNumber ? `?session=${encodeURIComponent(sessionNumber)}` : ''}`,
  availability: (slotCode?: string) =>
    `${PATHS.user.availability}${slotCode ? `?slot=${encodeURIComponent(slotCode)}` : ''}`,
};

/** Registration page for a parking-user category. */
export const registerPath = (category: 'student' | 'staff') => `/register/${category}`;

/** Landing page for each role after sign-in. */
export const ROLE_HOME: Record<UserRole, string> = {
  ADMIN: PATHS.admin.root,
  SECURITY_STAFF: PATHS.staff.root,
  PARKING_USER: PATHS.user.root,
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
