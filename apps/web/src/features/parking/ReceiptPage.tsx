import type { ReceiptView } from '@cpvts/shared';
import { Download, LoaderCircle, Printer } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { receiptVerificationUrl } from '@/app/paths';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { useQrDataUrl } from '@/components/parking/use-qr-data-url';
import { Button } from '@/components/ui/button';
import { branding } from '@/config/branding';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';
import type { ReceiptImageRow } from '@/lib/receipt-image';

import { parkingApi } from './parking-api';
import { useReceiptDownload, useReceiptRows } from './receipt-hooks';

function ReceiptRows({ rows, className }: { rows: ReceiptImageRow[]; className?: string }) {
  return (
    <dl className={className}>
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-1">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-right font-medium break-all">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The printable receipt (Master Blueprint §34). Values come from the finalized transaction. */
export function ReceiptDocument({ receipt }: { receipt: ReceiptView }) {
  const { t } = useTranslation();
  const verifyUrl = receiptVerificationUrl(receipt.verificationReference);
  const qr = useQrDataUrl(verifyUrl, 360);
  const rows = useReceiptRows(receipt);

  return (
    <article
      id="receipt"
      className="mx-auto w-full max-w-md rounded-xl border bg-card p-6 text-sm text-card-foreground shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none"
    >
      <header className="text-center">
        <p className="text-3xl font-bold tracking-wide">{branding.shortName}</p>
        <p className="font-medium text-muted-foreground">{branding.productName}</p>
        <p className="text-muted-foreground">{branding.institutionName}</p>
      </header>
      <hr className="my-4 border-dashed" />
      <h2 className="mb-3 text-center text-base font-bold tracking-widest uppercase">
        {t('parking.receipt.heading')}
      </h2>
      <ReceiptRows rows={rows.details} />
      <hr className="my-3 border-dashed" />
      <ReceiptRows rows={rows.fee} />
      <hr className="my-3 border-dashed" />
      <div className="flex items-baseline justify-between text-lg font-bold">
        <span>{rows.total.label}</span>
        <span>{rows.total.value}</span>
      </div>
      <hr className="my-3 border-dashed" />
      <ReceiptRows rows={rows.payment} />
      {receipt.payment.isSimulated && (
        <p className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-center text-xs text-foreground">
          {t('parking.receipt.demoNote')}
        </p>
      )}
      <div className="mt-5 flex flex-col items-center gap-2">
        {qr && (
          <img
            src={qr}
            alt={t('parking.receipt.verifyHint')}
            width={150}
            height={150}
            className="bg-white"
          />
        )}
        <p className="text-xs text-muted-foreground">{t('parking.receipt.verifyHint')}</p>
      </div>
      <p className="mt-5 text-center font-semibold">
        {t('parking.receipt.thanks', { product: branding.shortName })}
      </p>
    </article>
  );
}

export function ReceiptPage() {
  const { t } = useTranslation();
  const { receiptNumber = '' } = useParams();
  const fetcher = useCallback(
    (signal: AbortSignal) => parkingApi.receipt(receiptNumber, signal),
    [receiptNumber],
  );
  const query = useApiQuery(fetcher);

  return (
    <>
      <div className="print:hidden">
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
    </>
  );
}

export function ReceiptActions({ receipt }: { receipt: ReceiptView }) {
  const { t } = useTranslation();
  const { download, downloading, ready } = useReceiptDownload(receipt);

  return (
    <>
      <Button variant="outline" onClick={() => window.print()}>
        <Printer aria-hidden />
        {t('parking.receipt.print')}
      </Button>
      <Button onClick={() => void download()} disabled={downloading || !ready}>
        {downloading ? (
          <LoaderCircle className="animate-spin" aria-hidden />
        ) : (
          <Download aria-hidden />
        )}
        {t('parking.receipt.download')}
      </Button>
    </>
  );
}
