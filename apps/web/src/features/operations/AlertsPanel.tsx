import type { AlertSeverity, ParkingAlert } from '@cpvts/shared';
import { Ban, BellRing, CircleCheck, Clock, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { areaPaths } from '@/app/paths';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { StatusBadge, type StatusTone } from '@/components/feedback/StatusBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';

import { operationsApi } from './operations-api';

const REFRESH_MS = 30_000;

const SEVERITY_TONE: Record<AlertSeverity, StatusTone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'neutral',
};

const KIND_ICON = {
  ZONE_FULL: OctagonAlert,
  ZONE_NEARLY_FULL: TriangleAlert,
  LONG_DURATION: Clock,
  SLOT_BLOCKED: Ban,
} as const;

/** Rule-based parking alerts (Master Blueprint §26), refreshed every 30 s. */
export function AlertsPanel() {
  const { t } = useTranslation();
  const format = useFormatters();
  const query = useApiQuery(operationsApi.alerts, { refreshIntervalMs: REFRESH_MS });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-5" aria-hidden />
          {t('alerts.title')}
        </CardTitle>
        {query.status === 'success' && (
          <CardDescription>
            {t('alerts.rules', {
              percent: query.data.thresholds.nearlyFullPercent,
              hours: query.data.thresholds.longDurationHours,
            })}{' '}
            · {t('public.availability.lastUpdated', { time: format.time(query.data.generatedAt) })}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {query.status === 'loading' && <LoadingState />}
        {query.status === 'error' && (
          <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
        )}
        {query.status === 'success' &&
          (query.data.alerts.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheck className="size-4 text-success" aria-hidden />
              {t('alerts.none')}
            </p>
          ) : (
            <ul className="divide-y" aria-live="polite">
              {query.data.alerts.map((alert) => (
                <AlertRow key={alertKey(alert)} alert={alert} />
              ))}
            </ul>
          ))}
      </CardContent>
    </Card>
  );
}

const alertKey = (alert: ParkingAlert): string => {
  switch (alert.kind) {
    case 'ZONE_FULL':
    case 'ZONE_NEARLY_FULL':
      return `${alert.kind}:${alert.zone.code}`;
    case 'LONG_DURATION':
      return `${alert.kind}:${alert.session.sessionNumber}`;
    case 'SLOT_BLOCKED':
      return `${alert.kind}:${alert.slot.code}`;
  }
};

function AlertRow({ alert }: { alert: ParkingAlert }) {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const paths = areaPaths(user.role);
  const Icon = KIND_ICON[alert.kind];

  let message: ReactNode;
  switch (alert.kind) {
    case 'ZONE_FULL':
    case 'ZONE_NEARLY_FULL':
      message = (
        <>
          {t(alert.kind === 'ZONE_FULL' ? 'alerts.zoneFull' : 'alerts.zoneNearlyFull', {
            zone: alert.zone.name,
            occupied: alert.zone.occupied,
            usable: alert.zone.usable,
            percent: alert.zone.percent,
          })}
          {alert.zone.availableSlots.length > 0 && (
            <span className="block text-muted-foreground">
              {t('alerts.availableSlots', { slots: alert.zone.availableSlots.join(', ') })}
            </span>
          )}
        </>
      );
      break;
    case 'LONG_DURATION':
      message = (
        <>
          {t('alerts.longDuration', {
            vehicle: alert.session.vehicleNumber,
            slot: alert.session.slotCode,
            count: alert.session.durationHours,
          })}{' '}
          <Link
            to={paths.session(alert.session.sessionNumber)}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('parking.common.viewSession')}
          </Link>
        </>
      );
      break;
    case 'SLOT_BLOCKED':
      message = (
        <>
          {t('alerts.slotBlocked', { slot: alert.slot.code, zone: alert.slot.zoneName })}
          {alert.slot.reason && (
            <span className="block text-muted-foreground">
              {t('alerts.reason', { reason: alert.slot.reason })}
            </span>
          )}
        </>
      );
      break;
  }

  return (
    <li className="flex items-start gap-3 py-3 text-sm first:pt-0 last:pb-0">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">{message}</div>
      <StatusBadge tone={SEVERITY_TONE[alert.severity]}>
        {t(`alerts.severity.${alert.severity}`)}
      </StatusBadge>
    </li>
  );
}
