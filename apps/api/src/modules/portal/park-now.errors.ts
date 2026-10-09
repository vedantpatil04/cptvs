import { AppError } from '../../lib/errors.js';

export const parkNowErrors = {
  offerNotFound: () =>
    new AppError(404, 'OFFER_NOT_FOUND', 'This parking offer no longer exists. Start again.'),
  offerExpired: () =>
    new AppError(
      409,
      'OFFER_EXPIRED',
      'Your reserved parking space expired and was released. Start again.',
    ),
};
