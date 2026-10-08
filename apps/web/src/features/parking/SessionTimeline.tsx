import type { TimelineEvent } from '@cpvts/shared';
import { History } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { operationsApi } from '@/features/operations/operations-api';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { formatHour } from '@/lib/format';

/** Audit-backed replay of one session (Master Blueprint §19). */
export function SessionTimeline({ sessionNumber }: { sessionNumber: string }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const fetcher = useCallback(
    (signal: AbortSignal) => operationsApi.timeline(sessionNumber, signal),
    [sessionNumber],
  );
  const query = useApiQuery(fetcher);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('timeline.title')}</CardTitle>
        <CardDescription>{t('timeline.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.status === 'loading' && <LoadingState />}
        {query.status === 'error' && (
          <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
        )}
        {query.status === 'success' &&
          (query.data.events.length === 0 ? (
            <EmptyState icon={History} title={t('timeline.empty')} />
          ) : (
            <ol className="relative space-y-5 border-l pl-6">
              {query.data.events.map((event, index) => (
                <li key={`${event.at}-${event.action}-${index}`} className="relative">
                  <span
                    className="absolute top-1.5 -left-[29px] size-2.5 rounded-full bg-primary ring-4 ring-card"
                    aria-hidden
                  />
                  <p className="font-medium">{t(`audit.actions.${event.action}`)}</p>
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={event.at}>{format.dateTime(event.at)}</time>
                    {event.actor &&
                      ` · ${event.actor.fullName} (${t(`roles.${event.actor.role}`)})`}
                  </p>
                  <TimelineDetails event={event} />
                </li>
              ))}
            </ol>
          ))}
      </CardContent>
    </Card>
  );
}

function TimelineDetails({ event }: { event: TimelineEvent }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const { details } = event;
  const parts: string[] = [];

  if (details.vehicleNumber) parts.push(details.vehicleNumber);
  if (details.slotCode) parts.push(`${t('parking.common.slot')} ${details.slotCode}`);
  if (details.score !== undefined) parts.push(t('timeline.score', { score: details.score }));
  if (details.entryHour !== undefined) {
    parts.push(`${t('parking.common.entryHour')} ${formatHour(details.entryHour)}`);
  }
  if (details.exitHour !== undefined) {
    parts.push(`${t('parking.common.exitHour')} ${formatHour(details.exitHour)}`);
  }
  if (details.durationHours !== undefined) {
    parts.push(t('parking.common.hours', { count: details.durationHours }));
  }
  if (details.amountPaise !== undefined) parts.push(format.paise(details.amountPaise));
  if (details.method) parts.push(t(`parking.paymentMethods.${details.method}`));
  if (details.transactionId) parts.push(details.transactionId);
  if (details.receiptNumber) parts.push(details.receiptNumber);
  if (details.reason) parts.push(details.reason);

  if (parts.length === 0) return null;
  return <p className="mt-1 text-sm text-muted-foreground">{parts.join(' · ')}</p>;
}
