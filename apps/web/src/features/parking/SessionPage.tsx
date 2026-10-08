import { entryQrPayload } from '@cpvts/shared';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { FeeBreakdownView } from '@/components/parking/FeeBreakdownView';
import { QrCode } from '@/components/parking/QrCode';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';

import { ActiveVehicleCard } from './ActiveVehicleCard';
import { parkingApi } from './parking-api';

/** One parking session: details, actions, entry QR (active) or final fee (completed). */
export function SessionPage() {
  const { t } = useTranslation();
  const { sessionNumber = '' } = useParams();
  const fetcher = useCallback(
    (signal: AbortSignal) => parkingApi.session(sessionNumber, signal),
    [sessionNumber],
  );
  const query = useApiQuery(fetcher);

  return (
    <>
      <PageHeader title={t('parking.session.title')} description={sessionNumber} />
      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}
      {query.status === 'success' && (
        <div className="space-y-6">
          <ActiveVehicleCard session={query.data} />
          <div className="grid gap-6 md:grid-cols-2">
            {query.data.entryReference && (
              <Card className="items-center text-center">
                <CardHeader className="w-full">
                  <CardTitle>{t('parking.entry.entryQrTitle')}</CardTitle>
                  <CardDescription>{t('parking.entry.entryQrHint')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <QrCode
                    value={entryQrPayload(query.data.entryReference)}
                    label={t('parking.entry.entryQrTitle')}
                  />
                </CardContent>
              </Card>
            )}
            {query.data.fee && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('parking.fee.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <FeeBreakdownView fee={query.data.fee} />
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
