import {
  OWNER_CATEGORIES,
  VEHICLE_TYPES,
  type AnalyticsResponse,
  type ZoneUsage,
} from '@cpvts/shared';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { ColumnChart } from '@/components/charts/ColumnChart';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { formatHour } from '@/lib/format';
import { cn } from '@/lib/utils';

import { adminApi } from './admin-api';

/** Shifts a YYYY-MM-DD calendar date by whole days. */
const shiftDate = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

/** Daily parking analytics (Master Blueprint §25). Every figure comes from the API. */
export function AnalyticsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('date') ?? undefined;

  const fetcher = useCallback(
    (signal: AbortSignal) => adminApi.analytics(requested, signal),
    [requested],
  );
  const query = useApiQuery(fetcher);
  const setDate = (date?: string) => setParams(date ? { date } : {});
  // While another date loads, the previous figures stay visible but dimmed.
  const stale = query.status === 'success' && requested && query.data.date !== requested;

  return (
    <>
      <PageHeader title={t('analytics.title')} description={t('analytics.description')} />
      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState
          description={errorMessage(t, query.error)}
          onRetry={query.refetch}
          actions={
            requested && (
              <Button variant="outline" onClick={() => setDate()}>
                {t('analytics.today')}
              </Button>
            )
          }
        />
      )}
      {query.status === 'success' && (
        <div className="space-y-6">
          <DateControls date={query.data.date} onChange={setDate} />
          <div className={cn('space-y-6 transition-opacity', stale && 'opacity-60')}>
            <AnalyticsBody data={query.data} />
          </div>
        </div>
      )}
    </>
  );
}

function DateControls({ date, onChange }: { date: string; onChange: (date?: string) => void }) {
  const { t } = useTranslation();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('date') ?? '');
    if (value) onChange(value);
  };

  return (
    <form key={date} onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1.5">
        <Label htmlFor="analytics-date">{t('analytics.date')}</Label>
        <Input
          id="analytics-date"
          name="date"
          type="date"
          defaultValue={date}
          className="w-44"
          required
        />
      </div>
      <Button type="submit">
        <CalendarDays aria-hidden />
        {t('analytics.show')}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('analytics.previousDay')}
        onClick={() => onChange(shiftDate(date, -1))}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('analytics.nextDay')}
        onClick={() => onChange(shiftDate(date, 1))}
      >
        <ChevronRight aria-hidden />
      </Button>
      <Button type="button" variant="ghost" onClick={() => onChange()}>
        {t('analytics.today')}
      </Button>
    </form>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="space-y-1 px-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function AnalyticsBody({ data }: { data: AnalyticsResponse }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const hours = data.occupancyByHour.map((row) => formatHour(row.hour));
  const count = (value: number) => format.number(value);

  return (
    <>
      <section
        aria-label={t('analytics.summary')}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        <Stat label={t('analytics.entered')} value={count(data.sessions.entered)} />
        <Stat label={t('analytics.completed')} value={count(data.sessions.completed)} />
        <Stat
          label={t('analytics.averageDuration')}
          value={
            data.sessions.averageDurationHours === null
              ? '—'
              : t('analytics.hoursShort', {
                  value: format.number(data.sessions.averageDurationHours),
                })
          }
        />
        <Stat
          label={t('analytics.peakEntryHour')}
          value={data.peakEntryHour === null ? '—' : formatHour(data.peakEntryHour)}
        />
        <Stat
          label={t('analytics.revenue')}
          value={format.paise(data.revenue.totalPaise)}
          hint={t('analytics.transactions', { count: data.revenue.transactions })}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('analytics.occupancyTitle')}</CardTitle>
            <CardDescription>{t('analytics.occupancyDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ColumnChart
              title={t('analytics.occupancyTitle')}
              categories={hours}
              categoryHeader={t('analytics.hour')}
              formatValue={count}
              series={VEHICLE_TYPES.map((type, index) => ({
                key: type,
                label: t(`vehicleTypes.${type}`),
                color: `var(--chart-${index + 1})`,
                values: data.occupancyByHour.map((row) => row[type]),
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('analytics.entriesTitle')}</CardTitle>
            <CardDescription>{t('analytics.entriesDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ColumnChart
              title={t('analytics.entriesTitle')}
              categories={hours}
              categoryHeader={t('analytics.hour')}
              formatValue={count}
              series={[
                {
                  key: 'entries',
                  label: t('analytics.entriesSeries'),
                  color: 'var(--chart-1)',
                  values: data.entriesByHour.map((row) => row.count),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('analytics.revenueByVehicleType')}</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              rows={VEHICLE_TYPES.map((type) => ({
                label: t(`vehicleTypes.${type}`),
                value: data.revenue.byVehicleType[type],
              }))}
              formatValue={format.paise}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('analytics.revenueByOwnerCategory')}</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              rows={OWNER_CATEGORIES.map((category) => ({
                label: t(`ownerCategories.${category}`),
                value: data.revenue.byOwnerCategory[category],
              }))}
              formatValue={format.paise}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t('analytics.zonesTitle')}</CardTitle>
            <CardDescription>{t('analytics.zonesDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ZoneTable zones={data.zones} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('analytics.topSlotsTitle')}</CardTitle>
            <CardDescription>{t('analytics.topSlotsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topSlots.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('analytics.noSessions')}</p>
            ) : (
              <BarList
                rows={data.topSlots.map((slot) => ({
                  label: `${slot.slotCode} · ${slot.zoneName}`,
                  value: slot.sessions,
                }))}
                formatValue={count}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Horizontal bars for a few categories: one series, value at each bar's tip. */
function BarList({
  rows,
  formatValue,
}: {
  rows: { label: string; value: number }[];
  formatValue: (value: number) => string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label} className="space-y-1">
          <p className="text-sm text-muted-foreground">{row.label}</p>
          <div className="flex items-center gap-2">
            <div className="h-3 min-w-0 flex-1">
              <div
                className="h-full rounded-r-[4px] bg-chart-1"
                style={{ width: max > 0 ? `${(row.value / max) * 100}%` : 0 }}
              />
            </div>
            <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">
              {formatValue(row.value)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ZoneTable({ zones }: { zones: ZoneUsage[] }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const percent = (value: number) => t('dashboard.kpi.percent', { value: format.number(value) });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('parking.common.zone')}</TableHead>
          <TableHead className="text-right">{t('analytics.sessionsColumn')}</TableHead>
          <TableHead className="min-w-40">{t('analytics.peakOccupancy')}</TableHead>
          <TableHead className="text-right">{t('analytics.currentOccupancy')}</TableHead>
          <TableHead className="text-right">{t('analytics.usableSlots')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {zones.map((zone) => (
          <TableRow key={zone.code}>
            <TableCell>
              <span className="font-medium">{zone.name}</span>
              <span className="block text-xs text-muted-foreground">
                {t(`vehicleTypes.${zone.vehicleType}`)}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {format.number(zone.sessions)}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <div className="h-2 min-w-16 flex-1 rounded-full bg-chart-1/15">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      zone.peakOccupancyPercent >= 100
                        ? 'bg-destructive'
                        : zone.peakOccupancyPercent >= 90
                          ? 'bg-warning'
                          : 'bg-chart-1',
                    )}
                    style={{ width: `${Math.min(zone.peakOccupancyPercent, 100)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums">
                  {zone.peakOccupied} · {percent(zone.peakOccupancyPercent)}
                </span>
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {zone.currentOccupied} · {percent(zone.currentOccupancyPercent)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {zone.usableSlots} / {zone.totalSlots}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
