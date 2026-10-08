import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { AvailabilityStrip } from '@/components/user/AvailabilityStrip';
import { ParkingLayout } from '@/components/user/ParkingLayout';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';

import { figuresFromLayout } from './availability-figures';
import { userApi } from './user-api';

/** Live availability and the slot layout (T-01 … F-05). Other users' vehicles are never shown. */
export function AvailabilityPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const [params] = useSearchParams();
  const layout = useApiQuery(userApi.layout, { refreshIntervalMs: 20_000 });

  return (
    <>
      <PageHeader
        title={t('user.availability.title')}
        description={t('user.availability.description')}
        actions={
          <Button variant="outline" size="sm" onClick={layout.refetch}>
            <RefreshCw aria-hidden />
            {t('public.availability.refresh')}
          </Button>
        }
      />
      {layout.status === 'loading' && <LoadingState />}
      {layout.status === 'error' && (
        <ErrorState description={errorMessage(t, layout.error)} onRetry={layout.refetch} />
      )}
      {layout.status === 'success' && (
        <div className="space-y-8">
          <div className="space-y-2">
            <AvailabilityStrip figures={figuresFromLayout(layout.data)} />
            <p className="text-xs text-muted-foreground">
              {t('public.availability.lastUpdated', { time: format.time(layout.data.generatedAt) })}
            </p>
          </div>
          <ParkingLayout
            layout={layout.data}
            focusSlot={params.get('slot')}
            scrollToFocus={params.has('slot')}
          />
        </div>
      )}
    </>
  );
}
