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
  slotInUse: () =>
    new AppError(
      409,
      'SLOT_IN_USE',
      'This slot is occupied or temporarily held. Wait until it is free.',
    ),
  slotHasHistory: () =>
    new AppError(
      409,
      'SLOT_HAS_HISTORY',
      'A slot with parking history cannot be renamed or moved. Archive it and create a new slot.',
    ),
  slotArchived: () =>
    new AppError(409, 'SLOT_ARCHIVED', 'This slot is archived. Restore it before changing it.'),
  slotNotArchived: () => new AppError(409, 'SLOT_NOT_ARCHIVED', 'This slot is not archived.'),
  slotCodeTaken: (archived = false) =>
    new AppError(
      409,
      'SLOT_CODE_TAKEN',
      archived
        ? 'A slot with this ID exists in the archive. Restore it instead of creating a new one.'
        : 'A slot with this ID already exists.',
    ),
  slotCodeMismatch: () =>
    new AppError(
      400,
      'SLOT_CODE_MISMATCH',
      'The slot ID must start with T- for two-wheeler zones and F- for four-wheeler zones.',
    ),
  zoneNotFound: () => new AppError(404, 'ZONE_NOT_FOUND', 'Parking zone not found.'),
  zoneInactive: () => new AppError(409, 'ZONE_INACTIVE', 'This zone (or its block) is not active.'),
  zoneTypeMismatch: () =>
    new AppError(
      409,
      'ZONE_TYPE_MISMATCH',
      'The vehicle type does not match the vehicle type of this zone.',
    ),
  zoneCodeTaken: () =>
    new AppError(409, 'ZONE_CODE_TAKEN', 'A zone with this code already exists.'),
  zoneInUse: () =>
    new AppError(
      409,
      'ZONE_IN_USE',
      'This zone has slots or parked vehicles, so this change is not allowed.',
    ),
  blockNotFound: () => new AppError(404, 'BLOCK_NOT_FOUND', 'Parking block not found.'),
  blockCodeTaken: () =>
    new AppError(409, 'BLOCK_CODE_TAKEN', 'A block with this code already exists.'),
  blockInUse: () =>
    new AppError(
      409,
      'BLOCK_IN_USE',
      'Vehicles are parked (or slots held) in this block, so it cannot be deactivated.',
    ),
  dateRangeTooLarge: () =>
    new AppError(
      400,
      'DATE_RANGE_TOO_LARGE',
      `The date range cannot be longer than ${MAX_RANGE_DAYS} days.`,
    ),
};
