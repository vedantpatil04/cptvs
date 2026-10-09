import { ArrowLeft } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { ReceiptActions, ReceiptDocument } from '@/features/parking/ReceiptPage';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';

import { portalApi } from './portal-api';

export function PortalReceiptDetailPage() {
  const { t } = useTranslation();
  const { receiptNumber = '' } = useParams();

  const fetcher = useCallback(
    () => portalApi.receipt(receiptNumber),
    [receiptNumber],
  );
  const query = useApiQuery(fetcher);

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <div className="mb-2">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 text-xs">
            <Link to="/portal/receipts">
              <ArrowLeft className="size-3.5" />
              Back to Receipts
            </Link>
          </Button>
        </div>

        <PageHeader
          title={t('parking.receipt.title')}
          description={receiptNumber}
          actions={query.status === 'success' && <ReceiptActions receipt={query.data} />}
        />
      </div>

      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}
      {query.status === 'success' && <ReceiptDocument receipt={query.data} />}
    </div>
  );
}
