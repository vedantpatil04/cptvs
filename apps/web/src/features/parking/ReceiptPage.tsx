import type { ReceiptView } from '@cpvts/shared';
import { Download, LoaderCircle, Printer } from 'lucide-react';
import { useCallback, useState } from 'react';
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
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { formatHour } from '@/lib/format';
import { downloadBlob, renderReceiptPng, type ReceiptImageRow } from '@/lib/receipt-image';

import { parkingApi } from './parking-api';

/** Rows shared by the on-screen receipt and the downloaded image. */
function useReceiptRows(receipt: ReceiptView) {
  const { t } = useTranslation();
  const format = useFormatters();

  const details: ReceiptImageRow[] = [
    { label: t('parking.receipt.receiptNumber'), value: receipt.receiptNumber },
    { label: t('parking.receipt.issuedAt'), value: format.dateTime(receipt.issuedAt) },
    { label: t('parking.common.vehicleNumber'), value: receipt.vehicleNumber },
    { label: t('parking.common.vehicleType'), value: t(`vehicleTypes.${receipt.vehicleType}`) },
    {
      label: t('parking.common.ownerCategory'),
      value: t(`ownerCategories.${receipt.ownerCategory}`),
    },
    { label: t('parking.common.block'), value: receipt.block.name },
    { label: t('parking.common.slot'), value: receipt.slotCode },
    { label: t('parking.common.entry'), value: formatHour(receipt.entryHour) },
    { label: t('parking.common.exit'), value: formatHour(receipt.exitHour) },
    {
      label: t('parking.common.duration'),
      value: t('parking.common.hours', { count: receipt.durationHours }),
    },
  ];
  const fee: ReceiptImageRow[] = receipt.fee.lines.map((line) => ({
    label:
      line.kind === 'FREE'
        ? t('parking.fee.free', { count: line.hours })
        : t('parking.fee.charged', { count: line.hours, rate: format.paise(line.ratePaise) }),
    value: format.paise(line.kind === 'FREE' ? 0 : line.amountPaise),
  }));
  const payment: ReceiptImageRow[] = [
    {
      label: t('parking.payment.statusLabel'),
      value: t(`parking.paymentStatus.${receipt.payment.status}`),
    },
    {
      label: t('parking.payment.methodLabel'),
      value: t(`parking.paymentMethods.${receipt.payment.method}`),
    },
    { label: t('parking.payment.transactionId'), value: receipt.payment.transactionId },
  ];
  const total: ReceiptImageRow = {
    label: t('parking.fee.total'),
    value: format.paise(receipt.totalPaise),
  };
  return { details, fee, payment, total };
}

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
  const rows = useReceiptRows(receipt);
  const qr = useQrDataUrl(receiptVerificationUrl(receipt.verificationReference), 360);
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await renderReceiptPng({
        brandLines: [branding.shortName, branding.productName, branding.institutionName],
        heading: t('parking.receipt.heading'),
        sections: [rows.details, rows.fee],
        total: rows.total,
        notes: [
          ...rows.payment.map((row) => `${row.label}: ${row.value}`),
          ...(receipt.payment.isSimulated ? [t('parking.receipt.demoNote')] : []),
        ],
        qrDataUrl: qr,
        qrCaption: t('parking.receipt.verifyHint'),
        footer: t('parking.receipt.thanks', { product: branding.shortName }),
      });
      downloadBlob(blob, `${receipt.receiptNumber}.png`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => window.print()}>
        <Printer aria-hidden />
        {t('parking.receipt.print')}
      </Button>
      <Button onClick={() => void download()} disabled={downloading || !qr}>
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
