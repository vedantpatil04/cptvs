import { AppError } from '../../lib/errors.js';

export const accountErrors = {
  emailTaken: () =>
    new AppError(409, 'EMAIL_TAKEN', 'An account with this e-mail address already exists.'),
  institutionalIdTaken: () =>
    new AppError(409, 'INSTITUTIONAL_ID_TAKEN', 'An account with this ID already exists.'),
  emailDomainNotAllowed: () =>
    new AppError(
      400,
      'EMAIL_DOMAIN_NOT_ALLOWED',
      'Use your institutional e-mail address to register.',
    ),
  invalidDocument: () =>
    new AppError(
      400,
      'INVALID_DOCUMENT',
      'The identity document must be a JPEG, PNG or PDF file of at most 2 MB.',
    ),
  verificationRequired: () =>
    new AppError(
      403,
      'VERIFICATION_REQUIRED',
      'Your identity verification must be approved before you can use this feature.',
    ),
  verificationNotRejected: () =>
    new AppError(
      409,
      'VERIFICATION_NOT_REJECTED',
      'A new document can be submitted only after a rejected verification.',
    ),
  verificationNotPending: () =>
    new AppError(409, 'VERIFICATION_NOT_PENDING', 'This verification has already been decided.'),
  vehicleAlreadyRegistered: () =>
    new AppError(
      409,
      'VEHICLE_ALREADY_REGISTERED',
      'This vehicle is already registered to an account.',
    ),
  vehicleNotFound: () => new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found.'),
  vehicleIdentityLocked: () =>
    new AppError(
      409,
      'VEHICLE_IDENTITY_LOCKED',
      'The number and type of a vehicle with parking history cannot be changed.',
    ),
  userNotFound: () => new AppError(404, 'USER_NOT_FOUND', 'User not found.'),
  documentNotFound: () => new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.'),
  cannotChangeOwnStatus: () =>
    new AppError(409, 'CANNOT_CHANGE_OWN_STATUS', 'You cannot deactivate your own account.'),
  visitorAccessDenied: () =>
    new AppError(
      404,
      'VISITOR_ACCESS_DENIED',
      'No visitor parking matches this vehicle number and session number.',
    ),
};
