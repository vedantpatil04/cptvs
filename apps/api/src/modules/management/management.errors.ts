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
  slotDisabled: () =>
    new AppError(409, 'SLOT_DISABLED', 'This slot is out of service. Enable it first.'),
  slotCodeTaken: () => new AppError(409, 'SLOT_CODE_TAKEN', 'A slot with this ID already exists.'),
  slotVehicleMismatch: () =>
    new AppError(
      409,
      'SLOT_VEHICLE_MISMATCH',
      'The vehicle type does not match this parking zone or the slot ID.',
    ),
  slotInUse: () =>
    new AppError(
      409,
      'SLOT_IN_USE',
      'A vehicle is parked in, or being assigned to, this slot. Check it out first.',
    ),
  zoneNotFound: () => new AppError(404, 'ZONE_NOT_FOUND', 'Parking zone not found.'),
  zoneInUse: () =>
    new AppError(
      409,
      'ZONE_IN_USE',
      'Vehicles are parked in this zone. Check them out before taking it out of service.',
    ),
  blockInUse: () =>
    new AppError(
      409,
      'BLOCK_IN_USE',
      'Vehicles are parked in this block. Check them out before taking it out of service.',
    ),
  blockNotFound: () => new AppError(404, 'BLOCK_NOT_FOUND', 'Parking block not found.'),
  dateRangeTooLarge: () =>
    new AppError(
      400,
      'DATE_RANGE_TOO_LARGE',
      `The date range cannot be longer than ${MAX_RANGE_DAYS} days.`,
    ),
};
