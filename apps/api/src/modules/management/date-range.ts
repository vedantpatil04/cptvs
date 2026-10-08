import { MAX_RANGE_DAYS } from '@cpvts/shared';

import {
  addCampusDays,
  campusDateStart,
  campusDateString,
  campusDaysInclusive,
} from '../../lib/campus-time.js';
import { managementErrors } from './management.errors.js';

export interface ResolvedRange {
  from: string;
  to: string;
  /** First instant of `from`. */
  start: Date;
  /** First instant after `to`. */
  end: Date;
}

/** Inclusive campus-date range with defaults (`to` = today, `from` = `defaultDays` before). */
export const resolveRange = (
  range: { from?: string; to?: string },
  defaultDays = 30,
): ResolvedRange => {
  const to = range.to ?? campusDateString();
  const from = range.from ?? addCampusDays(to, -(defaultDays - 1));
  if (campusDaysInclusive(from, to) > MAX_RANGE_DAYS) throw managementErrors.dateRangeTooLarge();
  return { from, to, start: campusDateStart(from), end: campusDateStart(addCampusDays(to, 1)) };
};

/** Optional date filter for a timestamp column; either bound may be open. */
export const optionalDateFilter = (range: { from?: string; to?: string }) => {
  if (range.from && range.to && campusDaysInclusive(range.from, range.to) > MAX_RANGE_DAYS) {
    throw managementErrors.dateRangeTooLarge();
  }
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: campusDateStart(range.from) } : {}),
    ...(range.to ? { lt: campusDateStart(addCampusDays(range.to, 1)) } : {}),
  };
};
