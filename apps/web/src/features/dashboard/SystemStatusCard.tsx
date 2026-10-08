import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DescriptionItem, DescriptionList } from '@/components/ui/description-list';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';

import { fetchSystemStatus } from './system-api';

/** Admin-only view of API and database health (`GET /api/v1/system/status`). */
export function SystemStatusCard() {
  const { t } = useTranslation();
  const format = useFormatters();
  const query = useApiQuery(fetchSystemStatus);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('system.title')}</CardTitle>
        <CardDescription>{t('system.description')}</CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon"
            onClick={query.refetch}
            disabled={query.status === 'loading'}
            aria-label={t('system.refresh')}
          >
            <RefreshCw
              className={query.status === 'loading' ? 'animate-spin' : undefined}
              aria-hidden
            />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {query.status === 'loading' && <LoadingState />}
        {query.status === 'error' && (
          <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
        )}
        {query.status === 'success' && (
          <DescriptionList>
            <DescriptionItem label={t('system.database')}>
              <StatusBadge tone={query.data.database.status === 'up' ? 'success' : 'danger'} dot>
                {t(query.data.database.status === 'up' ? 'system.up' : 'system.down')}
              </StatusBadge>
            </DescriptionItem>
            <DescriptionItem label={t('system.databaseLatency')}>
              {query.data.database.latencyMs === null
                ? t('common.notAvailable')
                : t('system.milliseconds', { value: format.number(query.data.database.latencyMs) })}
            </DescriptionItem>
            <DescriptionItem label={t('system.uptime')}>
              {t('system.uptimeValue', {
                hours: format.number(Math.floor(query.data.uptimeSeconds / 3600)),
                minutes: format.number(Math.floor((query.data.uptimeSeconds % 3600) / 60)),
              })}
            </DescriptionItem>
            <DescriptionItem label={t('system.environment')}>
              {query.data.environment}
            </DescriptionItem>
            <DescriptionItem label={t('system.version')}>{query.data.version}</DescriptionItem>
          </DescriptionList>
        )}
      </CardContent>
    </Card>
  );
}
