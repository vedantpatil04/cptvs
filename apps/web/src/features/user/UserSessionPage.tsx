import { MapPinned, ReceiptText } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { PATHS, userPaths } from '@/app/paths';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { BlockMapLink } from '@/components/parking/BlockMapLink';
import { CurrentParkingPanel } from '@/components/user/CurrentParkingPanel';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';

import { SessionFacts } from './MyParkingPage';
import { userApi } from './user-api';

/** Full details of one of the user's parking sessions. */
export function UserSessionPage() {
  const { t } = useTranslation();
  const { sessionNumber = '' } = useParams();
  const fetcher = useCallback(
    (signal: AbortSignal) => userApi.session(sessionNumber, signal),
    [sessionNumber],
  );
  const query = useApiQuery(fetcher);

  return (
    <>
      <PageHeader
        title={t('parking.session.title')}
        description={sessionNumber}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={PATHS.user.history}>{t('user.history.title')}</Link>
          </Button>
        }
      />
      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}
      {query.status === 'success' && (
        <div className="space-y-6">
          <CurrentParkingPanel session={query.data} />
          <div className="flex flex-wrap gap-2">
            {query.data.status === 'ACTIVE' && (
              <>
                <Button asChild>
                  <Link to={userPaths.locate(query.data.sessionNumber)}>
                    <MapPinned aria-hidden />
                    {t('user.actions.locate')}
                  </Link>
                </Button>
                <BlockMapLink coordinates={query.data.block.coordinates} size="default" />
              </>
            )}
            {query.data.receiptNumber && (
              <Button asChild variant="outline">
                <Link to={userPaths.receipt(query.data.receiptNumber)}>
                  <ReceiptText aria-hidden />
                  {t('parking.common.viewReceipt')}
                </Link>
              </Button>
            )}
          </div>
          <SessionFacts session={query.data} />
        </div>
      )}
    </>
  );
}
