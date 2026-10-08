import type { HistoryItem } from '@cpvts/shared';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { StatusBadge } from '@/components/feedback/StatusBadge';
import { PlateBadge } from '@/components/parking/PlateBadge';
import { useFormatters } from '@/hooks/use-formatters';
import { formatHour } from '@/lib/format';

/** One parking session as a compact, tappable row. Values are the server's, never recalculated. */
export function SessionRow({ item, to }: { item: HistoryItem; to: string }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const active = item.status === 'ACTIVE';

  return (
    <Link
      to={to}
      className="group flex items-center gap-3 px-1 py-3.5 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring sm:px-3"
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <PlateBadge value={item.vehicleNumber} className="text-sm" />
          <StatusBadge tone={active ? 'info' : 'neutral'} dot={active}>
            {t(`parking.sessionStatus.${item.status}`)}
          </StatusBadge>
        </div>
        <p className="text-sm text-muted-foreground">
          {format.date(item.entryAt)} · {formatHour(item.entryHour)}
          {item.exitHour !== null && ` – ${formatHour(item.exitHour)}`} · {item.blockName} ·{' '}
          <span translate="no">{item.slotCode}</span>
        </p>
      </div>
      <div className="shrink-0 text-right text-sm">
        <p className="font-semibold tabular-nums">
          {item.feePaise === null ? '—' : format.paise(item.feePaise)}
        </p>
        <p className="text-muted-foreground">
          {item.durationHours === null
            ? '—'
            : t('parking.common.hours', { count: item.durationHours })}
        </p>
      </div>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
