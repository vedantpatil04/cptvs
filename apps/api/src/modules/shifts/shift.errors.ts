import { AppError } from '../../lib/errors.js';

export const shiftErrors = {
  /** A gate operation needs a checked-in shift (see SHIFT_ENFORCEMENT). */
  required: () =>
    new AppError(
      403,
      'SHIFT_REQUIRED',
      'You need to be checked in to a shift to do this. Check in to your shift, or ask an administrator.',
    ),
  /** The guard's shift is past its end (and the grace period) without being checked out or extended. */
  ended: () =>
    new AppError(
      403,
      'SHIFT_ENDED',
      'Your shift has ended. Check out, or ask an administrator to extend it.',
    ),
  notFound: () => new AppError(404, 'SHIFT_NOT_FOUND', 'Shift not found.'),
  conflict: () =>
    new AppError(409, 'SHIFT_CONFLICT', 'This person already has a shift that overlaps this time.'),
  invalidState: (message = 'This shift cannot be changed in its current state.') =>
    new AppError(409, 'SHIFT_INVALID_STATE', message),
  tooEarly: () =>
    new AppError(409, 'SHIFT_TOO_EARLY', 'It is too early to check in to this shift.'),
  hasOpenPayments: () =>
    new AppError(
      409,
      'SHIFT_HAS_OPEN_PAYMENTS',
      'A payment of this shift is still open. Finish or cancel it first.',
    ),
  templateNotFound: () =>
    new AppError(404, 'SHIFT_TEMPLATE_NOT_FOUND', 'Shift template not found.'),
  templateNameTaken: () =>
    new AppError(
      409,
      'SHIFT_TEMPLATE_NAME_TAKEN',
      'A shift template with this name already exists.',
    ),
  staffNotFound: () =>
    new AppError(
      404,
      'SECURITY_STAFF_NOT_FOUND',
      'The selected person is not an active Security Staff member.',
    ),
  handoverAlreadyRecorded: () =>
    new AppError(
      409,
      'HANDOVER_ALREADY_RECORDED',
      'The cash handover of this shift has already been recorded.',
    ),
  handoverNotFound: () =>
    new AppError(404, 'HANDOVER_NOT_FOUND', 'No cash handover has been recorded for this shift.'),
  discrepancyNotOpen: () =>
    new AppError(409, 'DISCREPANCY_NOT_OPEN', 'This handover has no unresolved cash difference.'),
  cashNoteRequired: () =>
    new AppError(
      400,
      'CASH_NOTE_REQUIRED',
      'The cash does not match what the system expects. Enter the reason for the difference.',
    ),
};
