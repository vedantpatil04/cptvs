import { OWNER_CATEGORIES, VEHICLE_TYPES, type FeeRule, type FeeSchedule } from '@cpvts/shared';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useFormatters } from '@/hooks/use-formatters';

const describeRule = (t: TFunction, rule: FeeRule, formatPaise: (value: number) => string) => {
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

/** Displays the configured fee rules. It describes rules; it never calculates a fee. */
export function FeeTable({ schedule }: { schedule: FeeSchedule }) {
  const { t } = useTranslation();
  const format = useFormatters();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('public.fees.category')}</TableHead>
          {VEHICLE_TYPES.map((vehicleType) => (
            <TableHead key={vehicleType}>{t(`vehicleTypes.${vehicleType}`)}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {OWNER_CATEGORIES.map((category) => (
          <TableRow key={category}>
            <TableCell className="font-medium">{t(`ownerCategories.${category}`)}</TableCell>
            {VEHICLE_TYPES.map((vehicleType) => (
              <TableCell key={vehicleType} className="min-w-40 whitespace-normal">
                {describeRule(t, schedule.rules[category][vehicleType], format.paise)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
