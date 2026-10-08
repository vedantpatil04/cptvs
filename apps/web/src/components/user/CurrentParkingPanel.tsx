import type { ParkingSessionView } from '@cpvts/shared';
import { CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PlateBadge } from '@/components/parking/PlateBadge';
import { useFormatters } from '@/hooks/use-formatters';
import { formatHour } from '@/lib/format';
import { cn } from '@/lib/utils';

interface CurrentParkingPanelProps {
  session: ParkingSessionView;
  /** Replaces the default "Parked" eyebrow, e.g. "Vehicle found". */
  found?: boolean;
  /** Buttons for the dark surface (use the `inverse` button variants). */
  actions?: ReactNode;
  className?: string;
}

const Label = ({ children }: { children: ReactNode }) => (
  <dt className="text-[0.7rem] font-semibold tracking-widest text-sidebar-muted-foreground uppercase">
    {children}
  </dt>
);

/**
 * The one place that answers "where is my vehicle and what does it cost?".
 * Every value comes from the server; the fee is the backend's estimate.
 */
export function CurrentParkingPanel({
  session,
  found = false,
  actions,
  className,
}: CurrentParkingPanelProps) {
  const { t } = useTranslation();
  const format = useFormatters();
  const active = session.status === 'ACTIVE';
  const duration = active ? session.currentDurationHours : session.durationHours;
  const feePaise = active ? session.estimatedFee?.totalPaise : session.fee?.totalPaise;

  return (
    <section
      aria-label={t('user.current.title')}
      className={cn(
        'overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground shadow-sm',
        className,
      )}
    >
      <div className="relative isolate px-5 pt-5 pb-6 sm:px-8 sm:pt-7 sm:pb-8">
        <div className="bay-lines absolute inset-x-0 bottom-0 -z-10 h-1/2 text-sidebar-foreground opacity-40" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold tracking-wide text-sidebar-accent-foreground uppercase">
            {found ? (
              <CircleCheck className="size-4 text-live" aria-hidden />
            ) : (
              <span className="size-2 rounded-full bg-live" aria-hidden />
            )}
            {found
              ? t('user.locate.found')
              : active
                ? t('parking.sessionStatus.ACTIVE')
                : t('parking.sessionStatus.COMPLETED')}
          </p>
          <p className="font-mono text-xs text-sidebar-muted-foreground" translate="no">
            {session.sessionNumber}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <PlateBadge value={session.vehicleNumber} className="text-lg" />
          <p className="text-sm text-sidebar-foreground/85">
            {t(`vehicleTypes.${session.vehicleType}`)} ·{' '}
            {t(`ownerCategories.${session.ownerCategory}`)}
          </p>
        </div>

        <dl className="mt-7 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
          <div className="min-w-0 space-y-1">
            <Label>{t('parking.common.block')}</Label>
            <dd className="text-lg leading-snug font-semibold text-sidebar-accent-foreground">
              {session.block.name}
            </dd>
          </div>
          <div className="space-y-1 text-right">
            <Label>{t('parking.common.slot')}</Label>
            <dd
              className="text-5xl leading-none font-bold tracking-tight text-sidebar-accent-foreground tabular-nums sm:text-6xl"
              translate="no"
            >
              {session.slotCode}
            </dd>
          </div>
        </dl>
      </div>

      <dl className="grid grid-cols-3 divide-x divide-sidebar-border border-t border-sidebar-border">
        <div className="space-y-1 px-5 py-4 sm:px-8">
          <Label>{t('parking.common.entry')}</Label>
          <dd className="font-semibold tabular-nums">{formatHour(session.entryHour)}</dd>
          <dd className="text-xs text-sidebar-muted-foreground">{format.date(session.entryAt)}</dd>
        </div>
        <div className="space-y-1 px-4 py-4">
          <Label>
            {active ? t('parking.common.currentDuration') : t('parking.common.duration')}
          </Label>
          <dd className="font-semibold tabular-nums">
            {duration === null ? '—' : t('parking.common.hours', { count: duration })}
          </dd>
        </div>
        <div className="space-y-1 px-4 py-4 sm:px-8">
          <Label>{active ? t('user.current.fee') : t('history.fee')}</Label>
          <dd className="font-semibold tabular-nums">
            {feePaise === undefined || feePaise === null ? '—' : format.paise(feePaise)}
          </dd>
        </div>
      </dl>

      {actions && (
        <div className="flex flex-wrap gap-2 border-t border-sidebar-border px-5 py-4 sm:px-8">
          {actions}
        </div>
      )}
    </section>
  );
}
