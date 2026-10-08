import type { ReceiptView } from '@cpvts/shared';
import { Download, Eye, LoaderCircle, Printer, Receipt } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';

import { receiptVerificationUrl, PATHS, userPaths } from '@/app/paths';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { PlateBadge } from '@/components/parking/PlateBadge';
import { QrCode } from '@/components/parking/QrCode';
import { Button } from '@/components/ui/button';
import { Pager } from '@/features/admin/Pager';
import { useFilterParams } from '@/features/admin/use-filter-params';
import { ReceiptActions, ReceiptDocument } from '@/features/parking/ReceiptPage';
import { useReceiptDownload } from '@/features/parking/receipt-hooks';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { formatHour } from '@/lib/format';

import { userApi } from './user-api';

const PAGE_SIZE = 8;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{children}</dd>
    </div>
  );
}

/** One receipt in the list: key facts, verification QR and View / Print / Download. */
function ReceiptItem({ receipt }: { receipt: ReceiptView }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const { download, downloading, ready } = useReceiptDownload(receipt);

  return (
    <li className="py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-sm font-semibold" translate="no">
              {receipt.receiptNumber}
            </p>
            <StatusBadge tone={receipt.payment.status === 'PAID' ? 'success' : 'warning'} dot>
              {t(`parking.paymentStatus.${receipt.payment.status}`)}
            </StatusBadge>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Field label={t('parking.common.vehicleNumber')}>
              <PlateBadge value={receipt.vehicleNumber} className="text-xs" />
            </Field>
            <Field label={t('parking.common.vehicleType')}>
              {t(`vehicleTypes.${receipt.vehicleType}`)}
            </Field>
            <Field label={t('parking.common.ownerCategory')}>
              {t(`ownerCategories.${receipt.ownerCategory}`)}
            </Field>
            <Field label={t('parking.common.block')}>{receipt.block.name}</Field>
            <Field label={t('parking.common.slot')}>
              <span translate="no">{receipt.slotCode}</span>
            </Field>
            <Field label={t('parking.common.duration')}>
              {formatHour(receipt.entryHour)} – {formatHour(receipt.exitHour)} ·{' '}
              {t('parking.common.hours', { count: receipt.durationHours })}
            </Field>
            <Field label={t('history.fee')}>
              <span className="font-bold tabular-nums">{format.paise(receipt.totalPaise)}</span>
            </Field>
            <Field label={t('parking.payment.transactionId')}>
              <span className="font-mono text-xs" translate="no">
                {receipt.payment.transactionId}
              </span>
            </Field>
            <Field label={t('parking.receipt.issuedAt')}>{format.dateTime(receipt.issuedAt)}</Field>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to={userPaths.receipt(receipt.receiptNumber)}>
                <Eye aria-hidden />
                {t('user.receipts.view')}
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={userPaths.receipt(receipt.receiptNumber, true)}>
                <Printer aria-hidden />
                {t('parking.receipt.print')}
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void download()}
              disabled={downloading || !ready}
            >
              {downloading ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <Download aria-hidden />
              )}
              {t('parking.receipt.download')}
            </Button>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1 self-start rounded-lg border bg-white p-2">
          <QrCode
            value={receiptVerificationUrl(receipt.verificationReference)}
            label={t('parking.receipt.verifyHint')}
            size={96}
          />
        </div>
      </div>
    </li>
  );
}

/** The signed-in user's own receipts only. */
export function ReceiptsPage() {
  const { t } = useTranslation();
  const { page, setPage } = useFilterParams([]);
  const fetcher = useCallback(
    (signal: AbortSignal) => userApi.receipts({ page, pageSize: PAGE_SIZE }, signal),
    [page],
  );
  const query = useApiQuery(fetcher);

  return (
    <>
      <PageHeader title={t('user.receipts.title')} description={t('user.receipts.description')} />
      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}
      {query.status === 'success' &&
        (query.data.total === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t('user.receipts.empty')}
            description={t('user.receipts.emptyHint')}
            action={
              <Button asChild variant="outline">
                <Link to={PATHS.user.history}>{t('user.history.title')}</Link>
              </Button>
            }
          />
        ) : (
          <>
            <ul className="divide-y rounded-xl border bg-card px-4 sm:px-6">
              {query.data.items.map((receipt) => (
                <ReceiptItem key={receipt.receiptNumber} receipt={receipt} />
              ))}
            </ul>
            <Pager
              page={query.data.page}
              pageSize={query.data.pageSize}
              total={query.data.total}
              onPage={setPage}
            />
          </>
        ))}
    </>
  );
}

/** A single receipt, ready to print or download. `?print=1` opens the print dialog. */
export function UserReceiptPage() {
  const { t } = useTranslation();
  const { receiptNumber = '' } = useParams();
  const [params] = useSearchParams();
  const fetcher = useCallback(
    (signal: AbortSignal) => userApi.receipt(receiptNumber, signal),
    [receiptNumber],
  );
  const query = useApiQuery(fetcher);
  const printed = useRef(false);

  useEffect(() => {
    if (query.status !== 'success' || params.get('print') !== '1' || printed.current) return;
    printed.current = true;
    // Give the QR code a moment to render before the print preview is taken.
    const timer = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(timer);
  }, [query.status, params]);

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={t('parking.receipt.title')}
          description={receiptNumber}
          actions={
            <>
              <Button asChild variant="ghost">
                <Link to={PATHS.user.receipts}>{t('user.receipts.title')}</Link>
              </Button>
              {query.status === 'success' && <ReceiptActions receipt={query.data} />}
            </>
          }
        />
      </div>
      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}
      {query.status === 'success' && <ReceiptDocument receipt={query.data} />}
    </>
  );
}
