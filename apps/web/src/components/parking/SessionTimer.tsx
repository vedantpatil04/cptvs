import type { ParkingSessionView } from '@cpvts/shared';
import { Clock, Receipt } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/hooks/use-formatters';
import { useServerNow } from '@/hooks/use-server-now';
import { campusHourAt, elapsedSeconds, formatClock } from '@/lib/duration';
import { formatHour } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Live `HH:MM:SS` since the session's server-recorded entry instant. */
export function ElapsedClock({ entryAt, className }: { entryAt: string; className?: string }) {
  const { t } = useTranslation();
  const seconds = elapsedSeconds(entryAt, useServerNow());
  return (
    <span
      role="timer"
      aria-label={t('parking.timer.elapsed')}
      className={cn('font-mono font-bold tabular-nums tracking-tight', className)}
    >
      {formatClock(seconds)}
    </span>
  );
}

interface SessionTimerProps {
  session: ParkingSessionView;
  /**
   * Called when the campus hour has moved on since the estimate was computed, so the page
   * can reload the session (the server owns the estimate).
   */
  onStale?: () => void;
  /** One-line version for lists and summary cards. */
  compact?: boolean;
  className?: string;
}

/**
 * The parking timer and the money that goes with it. While the session is active it counts up
 * from the authoritative entry instant and shows the estimated fee, clearly labelled as an
 * estimate; once completed it shows the exit time, the total time and the frozen final fee.
 */
export function SessionTimer({ session, onStale, compact = false, className }: SessionTimerProps) {
  const { t } = useTranslation();
  const format = useFormatters();
  const active = session.status === 'ACTIVE';
  const nowMs = useServerNow(active);

  // The estimate is priced by the server in whole campus hours; refresh it when the hour turns.
  const clockHour = campusHourAt(nowMs);
  const requestedHour = useRef<number | null>(null);
  useEffect(() => {
    if (!active || session.currentHour === null || clockHour === session.currentHour) return;
    if (requestedHour.current === clockHour) return;
    requestedHour.current = clockHour;
    onStale?.();
  }, [active, clockHour, session.currentHour, onStale]);

  if (!active) {
    const exitAt = session.exitAt;
    const total = exitAt ? elapsedSeconds(session.entryAt, Date.parse(exitAt)) : null;
    const finalFee = session.fee?.totalPaise ?? null;
    return (
      <div className={cn('rounded-xl border bg-muted/40 p-4 sm:p-5', className)}>
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('parking.timer.totalTime')}
        </p>
        <p className="mt-1 font-mono text-3xl font-bold tabular-nums">
          {total === null ? '—' : formatClock(total)}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{t('parking.timer.entered')}</dt>
            <dd className="font-medium">{format.dateTime(session.entryAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('parking.timer.exited')}</dt>
            <dd className="font-medium">{exitAt ? format.dateTime(exitAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('parking.timer.finalFee')}</dt>
            <dd className="text-lg font-bold">
              {finalFee === null ? '—' : format.paise(finalFee)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('parking.timer.billedHours')}</dt>
            <dd className="font-medium">
              {session.durationHours === null
                ? '—'
                : t('parking.common.hours', { count: session.durationHours })}
            </dd>
          </div>
        </dl>
      </div>
    );
  }

  const estimate = session.estimatedFee;
  const seconds = elapsedSeconds(session.entryAt, nowMs);

  if (compact) {
    return (
      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1', className)}>
        <span className="flex items-center gap-1.5">
          <Clock className="size-4 text-primary" aria-hidden />
          <span
            role="timer"
            aria-label={t('parking.timer.elapsed')}
            className="font-mono text-lg font-bold tabular-nums"
          >
            {formatClock(seconds)}
          </span>
        </span>
        <span className="text-sm text-muted-foreground">
          {t('parking.timer.estimatedFeeShort')}:{' '}
          <span className="font-semibold text-foreground">
            {estimate ? format.paise(estimate.totalPaise) : '—'}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <Clock className="size-4 text-primary" aria-hidden />
            {t('parking.timer.elapsed')}
          </p>
          <p
            role="timer"
            aria-label={t('parking.timer.elapsed')}
            className="mt-1 font-mono text-4xl font-bold tabular-nums tracking-tight text-primary sm:text-5xl"
          >
            {formatClock(seconds)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('parking.timer.entered')} {format.dateTime(session.entryAt)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-primary/15 pt-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Receipt className="size-4 text-muted-foreground" aria-hidden />
            {t('parking.timer.estimatedFee')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {session.currentHour !== null && session.currentDurationHours !== null
              ? t('parking.timer.estimateBasis', {
                  from: formatHour(session.entryHour),
                  to: formatHour(session.currentHour),
                  hours: t('parking.common.hours', { count: session.currentDurationHours }),
                })
              : t('parking.common.estimatedFeeHint')}
          </p>
        </div>
        <p className="shrink-0 text-2xl font-bold tabular-nums">
          {estimate ? format.paise(estimate.totalPaise) : '—'}
        </p>
      </div>
    </div>
  );
}
