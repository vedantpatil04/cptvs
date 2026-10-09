import { AppError } from '../../lib/errors.js';

/** Expected parking-operation failures. Clients translate them by `code`. */
export const parkingErrors = {
  duplicateActiveVehicle: () =>
    new AppError(409, 'DUPLICATE_ACTIVE_VEHICLE', 'This vehicle is already parked.'),
  vehicleTypeMismatch: () =>
    new AppError(
      409,
      'VEHICLE_TYPE_MISMATCH',
      'This vehicle number is registered with a different vehicle type.',
    ),
  zoneNotConfigured: () =>
    new AppError(
      409,
      'ZONE_NOT_CONFIGURED',
      'No parking zone is configured for this vehicle type.',
    ),
  zoneFull: () => new AppError(409, 'ZONE_FULL', 'No compatible parking slot is available.'),
  allocationFailed: () =>
    new AppError(
      409,
      'ALLOCATION_FAILED',
      'All candidate slots were taken by other terminals. Please try again.',
    ),
  sessionNotFound: (message = 'No matching parking session was found.') =>
    new AppError(404, 'SESSION_NOT_FOUND', message),
  sessionNotActive: () =>
    new AppError(409, 'SESSION_NOT_ACTIVE', 'This parking session has already been completed.'),
  vehicleSessionMismatch: () =>
    new AppError(
      409,
      'VEHICLE_SESSION_MISMATCH',
      'The vehicle number does not match this parking session.',
    ),
  sessionSlotMismatch: () =>
    new AppError(409, 'SESSION_SLOT_MISMATCH', 'The slot does not match this parking session.'),
  invalidQrReference: () =>
    new AppError(400, 'INVALID_QR_REFERENCE', 'The QR code is not a valid CPVTS session code.'),
  qrSessionMismatch: () =>
    new AppError(
      409,
      'QR_SESSION_MISMATCH',
      'This QR code does not belong to the session being checked out.',
    ),
  visitorVehicleRegistered: () =>
    new AppError(
      409,
      'VISITOR_VEHICLE_REGISTERED',
      'This vehicle is registered to a CPVTS account. Sign in and use Park My Vehicle.',
    ),
  reservationNotFound: () =>
    new AppError(404, 'RESERVATION_NOT_FOUND', 'No matching parking reservation was found.'),
  reservationExpired: () =>
    new AppError(
      409,
      'RESERVATION_EXPIRED',
      'This reservation has expired or was cancelled. The space was released.',
    ),
  reservationsBusy: () =>
    new AppError(
      409,
      'RESERVATIONS_BUSY',
      'Too many reservations are open right now. Please try again in a few minutes.',
    ),
  invalidExitCode: () =>
    new AppError(400, 'INVALID_EXIT_CODE', 'This exit code is invalid, expired or already used.'),
  sessionInconsistent: () =>
    new AppError(
      409,
      'SESSION_INCONSISTENT',
      'The parking records for this session do not agree. Ask an administrator to check them.',
    ),
  gateCheckoutRequired: () =>
    new AppError(
      403,
      'GATE_CHECKOUT_REQUIRED',
      'Final checkout is completed at the exit gate by Security Staff. Tell them you are ready to leave.',
    ),
  invalidPaymentMethod: () =>
    new AppError(
      400,
      'INVALID_PAYMENT_METHOD',
      'This payment method cannot be used for this amount.',
    ),
  paymentNotFound: () => new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found.'),
  paymentSessionMismatch: () =>
    new AppError(409, 'PAYMENT_SESSION_MISMATCH', 'This payment belongs to a different session.'),
  paymentNotPending: () =>
    new AppError(409, 'PAYMENT_NOT_PENDING', 'This payment is no longer pending.'),
  paymentInProgress: () =>
    new AppError(
      409,
      'PAYMENT_IN_PROGRESS',
      'A payment for this session is already being processed.',
    ),
  paymentAmountMismatch: () =>
    new AppError(
      409,
      'PAYMENT_AMOUNT_MISMATCH',
      'The payment amount no longer matches the calculated fee. Start checkout again.',
    ),
  receiptNotFound: () => new AppError(404, 'RECEIPT_NOT_FOUND', 'Receipt not found.'),
  sessionTimeLocked: () =>
    new AppError(
      409,
      'SESSION_TIME_LOCKED',
      'The times of a completed session cannot be changed here. Ask an administrator for a correction.',
    ),
  timeRangeInvalid: (
    code: 'ENTRY_AFTER_EXIT' | 'EXIT_IN_FUTURE' | 'TIME_RANGE_OVERNIGHT' | 'TIME_UNCHANGED',
  ) =>
    new AppError(
      400,
      code,
      {
        ENTRY_AFTER_EXIT: 'The entry time cannot be after the exit time.',
        EXIT_IN_FUTURE: 'The exit time cannot be in the future.',
        TIME_RANGE_OVERNIGHT:
          'Entry and exit must be on the same campus day. Hourly fees cannot be calculated across midnight.',
        TIME_UNCHANGED: 'The entry and exit times are unchanged.',
      }[code],
    ),
};
