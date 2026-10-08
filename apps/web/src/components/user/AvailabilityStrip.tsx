import type { VehicleType } from '@cpvts/shared';
import { Bike, Car } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/hooks/use-formatters';
import { cn } from '@/lib/utils';

export interface AvailabilityFigure {
  vehicleType: VehicleType;
  available: number;
  total: number;
  occupied?: number;
  blocked?: number;
}

const ICON = { TWO_WHEELER: Bike, FOUR_WHEELER: Car } as const;

/**
 * Live free-space figures for the two vehicle types, set as plain typography
 * on one surface instead of a pair of cards.
 */
export function AvailabilityStrip({
  figures,
  className,
}: {
  figures: AvailabilityFigure[];
  className?: string;
}) {
  const { t } = useTranslation();
  const format = useFormatters();

  return (
    <dl className={cn('grid grid-cols-2 divide-x rounded-xl border bg-card', className)}>
      {figures.map(({ vehicleType, available, total, occupied, blocked }) => {
        const Icon = ICON[vehicleType];
        const configured = total > 0;
        return (
          <div key={vehicleType} className="space-y-2 px-4 py-4 sm:px-6 sm:py-5">
            <dt className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Icon className="size-4" aria-hidden />
              {t(`vehicleTypes.${vehicleType}`)}
            </dt>
            <dd className="flex flex-wrap items-baseline gap-x-2">
              <span
                className={cn(
                  'text-4xl font-bold tabular-nums sm:text-5xl',
                  configured && available === 0 && 'text-destructive',
                )}
              >
                {configured ? format.number(available) : '—'}
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                {configured && available === 0
                  ? t('public.availability.full')
                  : t('user.availability.available')}
              </span>
            </dd>
            <dd className="text-xs text-muted-foreground tabular-nums">
              {configured
                ? occupied === undefined
                  ? t('public.availability.ofTotal', { total: format.number(total) })
                  : t('user.availability.breakdown', {
                      occupied: format.number(occupied),
                      blocked: format.number(blocked ?? 0),
                    })
                : t('public.availability.notConfigured')}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
