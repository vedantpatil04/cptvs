import { MAX_RANGE_DAYS } from '@cpvts/shared';

import { AppError } from '../../lib/errors.js';

export const managementErrors = {
  slotNotFound: () => new AppError(404, 'SLOT_NOT_FOUND', 'Parking slot not found.'),
  slotNotAvailable: () =>
    new AppError(
      409,
      'SLOT_NOT_AVAILABLE',
      'Only an available slot can be blocked. Check the vehicle out first.',
    ),
  slotNotBlocked: () => new AppError(409, 'SLOT_NOT_BLOCKED', 'This slot is not blocked.'),
  blockNotFound: () => new AppError(404, 'BLOCK_NOT_FOUND', 'Parking block not found.'),
  dateRangeTooLarge: () =>
    new AppError(
      400,
      'DATE_RANGE_TOO_LARGE',
      `The date range cannot be longer than ${MAX_RANGE_DAYS} days.`,
    ),
};
