/** Audit log action identifiers, shared so clients can label them. */
export const AUDIT_ACTIONS = {
  authLoginSucceeded: 'AUTH_LOGIN_SUCCEEDED',
  authLoginFailed: 'AUTH_LOGIN_FAILED',
  authLogout: 'AUTH_LOGOUT',
  vehicleCheckedIn: 'VEHICLE_CHECKED_IN',
  slotAssigned: 'SLOT_ASSIGNED',
  checkoutInitiated: 'CHECKOUT_INITIATED',
  paymentInitiated: 'PAYMENT_INITIATED',
  paymentSucceeded: 'PAYMENT_SUCCEEDED',
  paymentFailed: 'PAYMENT_FAILED',
  paymentCancelled: 'PAYMENT_CANCELLED',
  transactionFinalized: 'TRANSACTION_FINALIZED',
  receiptGenerated: 'RECEIPT_GENERATED',
  slotReleased: 'SLOT_RELEASED',
  slotBlocked: 'SLOT_BLOCKED',
  slotUnblocked: 'SLOT_UNBLOCKED',
  slotPriorityChanged: 'SLOT_PRIORITY_CHANGED',
  blockLocationUpdated: 'BLOCK_LOCATION_UPDATED',
  reportExported: 'REPORT_EXPORTED',
  /** A request was refused by a consistency/security rule (metadata.code says which). */
  integrityRejected: 'INTEGRITY_REJECTED',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
export const AUDIT_ACTION_CODES = Object.values(AUDIT_ACTIONS) as AuditAction[];

/** Entity types referenced by audit log entries. */
export const AUDIT_ENTITY_TYPES = {
  user: 'USER',
  parkingSession: 'PARKING_SESSION',
  parkingSlot: 'PARKING_SLOT',
  parkingBlock: 'PARKING_BLOCK',
  payment: 'PAYMENT',
  receipt: 'RECEIPT',
  vehicle: 'VEHICLE',
  report: 'REPORT',
} as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES];
export const AUDIT_ENTITY_TYPE_CODES = Object.values(AUDIT_ENTITY_TYPES) as AuditEntityType[];
