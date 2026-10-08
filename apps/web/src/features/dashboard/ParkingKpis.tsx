import type { DashboardSummary } from '@cpvts/shared';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { Card, CardContent } from '@/components/ui/card';
import { parkingApi } from '@/features/parking/parking-api';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';

const REFRESH_MS = 30_000;

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'danger' | 'muted';
}) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="space-y-1 px-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p
          className={cn(
            'text-2xl font-bold tabular-nums',
            tone === 'success' && 'text-success',
            tone === 'danger' && 'text-destructive',
            tone === 'muted' && 'text-muted-foreground',
          )}
        >
          {value}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Live parking KPIs (Master Blueprint §20). Revenue appears only when the API provides it. */
export function ParkingKpis() {
  const { t } = useTranslation();
  const query = useApiQuery(parkingApi.summary, { refreshIntervalMs: REFRESH_MS });

  if (query.status === 'loading') return <LoadingState />;
  if (query.status === 'error') {
    return <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />;
  }
  return <KpiGrid summary={query.data} />;
}

function KpiGrid({ summary }: { summary: DashboardSummary }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const percent = (value: number) => t('dashboard.kpi.percent', { value: format.number(value) });
  const [twoWheeler, fourWheeler] = summary.byVehicleType;

  return (
    <section aria-labelledby="kpi-title" className="space-y-3">
      <h2 id="kpi-title" className="text-lg font-semibold">
        {t('dashboard.kpi.title')}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label={t('dashboard.kpi.totalSlots')} value={format.number(summary.overall.total)} />
        <Kpi
          label={t('dashboard.kpi.occupied')}
          value={format.number(summary.overall.occupied)}
          tone="danger"
        />
        <Kpi
          label={t('dashboard.kpi.available')}
          value={format.number(summary.overall.available)}
          tone="success"
        />
        <Kpi
          label={t('dashboard.kpi.blocked')}
          value={format.number(summary.overall.blocked)}
          tone="muted"
        />
        <Kpi
          label={t('dashboard.kpi.occupancy')}
          value={percent(summary.overall.occupancyPercent)}
        />
        {twoWheeler && (
          <Kpi
            label={t('dashboard.kpi.vehicleTypeOccupancy', { type: t('vehicleTypes.TWO_WHEELER') })}
            value={percent(twoWheeler.occupancyPercent)}
            hint={t('dashboard.kpi.occupiedOfTotal', {
              occupied: twoWheeler.occupied,
              total: twoWheeler.total,
            })}
          />
        )}
        {fourWheeler && (
          <Kpi
            label={t('dashboard.kpi.vehicleTypeOccupancy', {
              type: t('vehicleTypes.FOUR_WHEELER'),
            })}
            value={percent(fourWheeler.occupancyPercent)}
            hint={t('dashboard.kpi.occupiedOfTotal', {
              occupied: fourWheeler.occupied,
              total: fourWheeler.total,
            })}
          />
        )}
        <Kpi
          label={t('dashboard.kpi.currentlyParked')}
          value={format.number(summary.currentlyParked)}
        />
        <Kpi
          label={t('dashboard.kpi.todayVehicles')}
          value={format.number(summary.todayVehicleCount)}
        />
        {summary.todayFeesCollectedPaise !== null && (
          <Kpi
            label={t('dashboard.kpi.todayFees')}
            value={format.paise(summary.todayFeesCollectedPaise)}
            hint={t('dashboard.kpi.todayFeesHint')}
          />
        )}
      </div>
    </section>
  );
}
