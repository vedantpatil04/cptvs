import { OWNER_CATEGORIES, VEHICLE_TYPES, type FeeSchedule } from '@cpvts/shared';
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

import { describeFeeRule } from './fee-rule';


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
                {describeFeeRule(t, schedule.rules[category][vehicleType], format.paise)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
