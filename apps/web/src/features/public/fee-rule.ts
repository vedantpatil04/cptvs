import type { FeeRule } from '@cpvts/shared';
import type { TFunction } from 'i18next';

/**
 * Plain-language description of one configured fee rule ("first 2 hours free, then ₹10 per hour").
 * It describes the rule; it never calculates a fee.
 */
export const describeFeeRule = (
  t: TFunction,
  rule: FeeRule,
  formatPaise: (value: number) => string,
): string => {
  switch (rule.type) {
    case 'FREE':
      return t('public.fees.free');
    case 'HOURLY':
      return t('public.fees.hourly', { rate: formatPaise(rule.hourlyRatePaise) });
    case 'FREE_HOURS_THEN_HOURLY':
      return t('public.fees.freeThenHourly', {
        count: rule.freeHours,
        rate: formatPaise(rule.hourlyRatePaise),
      });
  }
};
