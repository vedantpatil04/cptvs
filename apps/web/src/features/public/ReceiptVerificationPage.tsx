import { ArrowLeft, CircleCheck, CircleX, SearchX } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { PATHS } from '@/app/paths';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DescriptionItem, DescriptionList } from '@/components/ui/description-list';
import { branding } from '@/config/branding';
import { parkingApi } from '@/features/parking/parking-api';
import { useApiQuery } from '@/hooks/use-api-query';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';

/**
 * Public receipt verification (QR target). The URL carries only an opaque
 * reference; everything shown comes from the authoritative backend record.
 */
export function ReceiptVerificationPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const { reference = '' } = useParams();
  useDocumentTitle(t('parking.verify.title'));
  const fetcher = useCallback(
    (signal: AbortSignal) => parkingApi.verifyReceipt(reference, signal),
    [reference],
  );
  const query = useApiQuery(fetcher);
  const notFound =
    query.status === 'error' &&
    query.error instanceof ApiError &&
    (query.error.status === 404 || query.error.status === 400);

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link to={PATHS.home}>
          <ArrowLeft aria-hidden />
          {t('common.backToHome')}
        </Link>
      </Button>

      {query.status === 'loading' && <LoadingState label={t('parking.verify.checking')} />}

      {notFound && (
        <Card className="border-destructive/40 text-center">
          <CardHeader>
            <SearchX className="mx-auto size-10 text-destructive" aria-hidden />
            <CardTitle>{t('parking.verify.notFoundTitle')}</CardTitle>
            <CardDescription>{t('parking.verify.notFoundDescription')}</CardDescription>
          </CardHeader>
        </Card>
      )}
      {query.status === 'error' && !notFound && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}

      {query.status === 'success' && (
        <Card
          className={query.data.status === 'VALID' ? 'border-success/40' : 'border-destructive/40'}
        >
          <CardHeader className="text-center">
            {query.data.status === 'VALID' ? (
              <CircleCheck className="mx-auto size-12 text-success" aria-hidden />
            ) : (
              <CircleX className="mx-auto size-12 text-destructive" aria-hidden />
            )}
            <CardTitle
              className={
                query.data.status === 'VALID' ? 'text-xl text-success' : 'text-xl text-destructive'
              }
            >
              {query.data.status === 'VALID'
                ? t('parking.verify.validTitle')
                : t('parking.verify.invalidTitle')}
            </CardTitle>
            <CardDescription>
              {query.data.status === 'VALID'
                ? t('parking.verify.validDescription', { product: branding.shortName })
                : t('parking.verify.invalidDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DescriptionList>
              <DescriptionItem label={t('parking.receipt.receiptNumber')}>
                <span className="font-mono">{query.data.receipt.receiptNumber}</span>
              </DescriptionItem>
              <DescriptionItem label={t('parking.receipt.issuedAt')}>
                {format.dateTime(query.data.receipt.issuedAt)}
              </DescriptionItem>
              <DescriptionItem label={t('parking.common.vehicleNumber')}>
                <span className="font-mono">{query.data.receipt.vehicleNumber}</span>
              </DescriptionItem>
              <DescriptionItem label={t('parking.common.slot')}>
                {query.data.receipt.blockName} · {query.data.receipt.slotCode}
              </DescriptionItem>
              <DescriptionItem label={t('parking.common.duration')}>
                {t('parking.common.hours', { count: query.data.receipt.durationHours })}
              </DescriptionItem>
              <DescriptionItem label={t('parking.fee.total')}>
                <span className="text-lg font-bold">
                  {format.paise(query.data.receipt.amountPaise)}
                </span>
              </DescriptionItem>
              <DescriptionItem label={t('parking.payment.statusLabel')}>
                <StatusBadge
                  tone={query.data.receipt.paymentStatus === 'PAID' ? 'success' : 'danger'}
                >
                  {t(`parking.paymentStatus.${query.data.receipt.paymentStatus}`)}
                </StatusBadge>{' '}
                {query.data.receipt.isSimulated && (
                  <StatusBadge tone="warning">{t('parking.payment.testBadge')}</StatusBadge>
                )}
              </DescriptionItem>
              <DescriptionItem label={t('parking.verify.statusLabel')}>
                <StatusBadge tone={query.data.status === 'VALID' ? 'success' : 'danger'} dot>
                  {t(`parking.verify.status.${query.data.status}`)}
                </StatusBadge>
              </DescriptionItem>
            </DescriptionList>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
