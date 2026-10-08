import type { PublicAvailability } from '@cpvts/shared';
import { Bike, Car } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFormatters } from '@/hooks/use-formatters';

const ICONS = { TWO_WHEELER: Bike, FOUR_WHEELER: Car } as const;

/** Free spaces for one vehicle type. Shows counts only — never which slots. */
export function AvailabilityCard({ availability }: { availability: PublicAvailability }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const { vehicleType, totalSlots, availableSlots } = availability;
  const Icon = ICONS[vehicleType];
  const configured = totalSlots > 0;
  const freeShare = configured ? Math.round((availableSlots / totalSlots) * 100) : 0;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="grid size-9 place-items-center rounded-lg bg-secondary text-secondary-foreground">
            <Icon className="size-5" aria-hidden />
          </span>
          {t(`vehicleTypes.${vehicleType}`)}
        </CardTitle>
        <CardAction>
          {!configured ? (
            <StatusBadge tone="neutral">{t('public.availability.notConfigured')}</StatusBadge>
          ) : availableSlots > 0 ? (
            <StatusBadge tone="success" dot>
              {t('public.availability.spacesAvailable')}
            </StatusBadge>
          ) : (
            <StatusBadge tone="danger" dot>
              {t('public.availability.full')}
            </StatusBadge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-4xl font-bold tabular-nums">
            {configured ? format.number(availableSlots) : '—'}
          </span>
          {configured && (
            <span className="text-sm text-muted-foreground">
              {t('public.availability.ofTotal', { total: format.number(totalSlots) })}
            </span>
          )}
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className={
              availableSlots > 0
                ? 'h-full rounded-full bg-success'
                : 'h-full rounded-full bg-destructive'
            }
            style={{
              width: `${configured ? Math.max(freeShare, availableSlots > 0 ? 4 : 100) : 0}%`,
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
