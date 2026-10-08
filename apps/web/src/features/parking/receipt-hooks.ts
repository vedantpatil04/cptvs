import type { ReceiptView } from '@cpvts/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { receiptVerificationUrl } from '@/app/paths';
import { useQrDataUrl } from '@/components/parking/use-qr-data-url';
import { branding } from '@/config/branding';
import { useFormatters } from '@/hooks/use-formatters';
import { formatHour } from '@/lib/format';
import { downloadBlob, renderReceiptPng, type ReceiptImageRow } from '@/lib/receipt-image';

/** Rows shared by the on-screen receipt and the downloaded image. */
export function useReceiptRows(receipt: ReceiptView) {
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

/** Renders the receipt as a PNG and saves it. Shared by the staff and resident receipt views. */
export function useReceiptDownload(receipt: ReceiptView) {
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

  return { download, downloading, ready: Boolean(qr) };
}
