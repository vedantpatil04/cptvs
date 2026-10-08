import type { FeeBreakdown } from '@cpvts/shared';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/hooks/use-formatters';
import { cn } from '@/lib/utils';

/** Displays a breakdown produced by the backend fee engine. Performs no calculation. */
export function FeeBreakdownView({ fee, className }: { fee: FeeBreakdown; className?: string }) {
  const { t } = useTranslation();
  const format = useFormatters();

  return (
    <dl className={cn('space-y-2 text-sm', className)}>
      {fee.lines.map((line, index) => (
        <div key={index} className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">
            {line.kind === 'FREE'
              ? t('parking.fee.free', { count: line.hours })
              : t('parking.fee.charged', { count: line.hours, rate: format.paise(line.ratePaise) })}
          </dt>
          <dd className="font-medium tabular-nums">
            {format.paise(line.kind === 'FREE' ? 0 : line.amountPaise)}
          </dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 border-t pt-2 text-base">
        <dt className="font-semibold">{t('parking.fee.total')}</dt>
        <dd className="font-bold tabular-nums">{format.paise(fee.totalPaise)}</dd>
      </div>
    </dl>
  );
}
