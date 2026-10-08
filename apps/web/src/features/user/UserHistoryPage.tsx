import { portalHistoryQuerySchema, VEHICLE_TYPES, type HistoryItem } from '@cpvts/shared';
import { History } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { userPaths } from '@/app/paths';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { PlateBadge } from '@/components/parking/PlateBadge';
import { SessionRow } from '@/components/user/SessionRow';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FilterBar, type FilterField } from '@/features/admin/FilterBar';
import { Pager } from '@/features/admin/Pager';
import { useFilterParams } from '@/features/admin/use-filter-params';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { formatHour } from '@/lib/format';

import { userApi } from './user-api';

const FILTER_KEYS = ['from', 'to', 'vehicleNumber', 'vehicleType'] as const;
const PAGE_SIZE = 15;

/** The signed-in user's own parking history, with finalized values from the server. */
export function UserHistoryPage() {
  const { t } = useTranslation();
  const { filters, page, setFilters, setPage } = useFilterParams(FILTER_KEYS);
  const vehicles = useApiQuery(userApi.vehicles);

  const fetcher = useCallback(
    (signal: AbortSignal) => userApi.history({ ...filters, page, pageSize: PAGE_SIZE }, signal),
    [filters, page],
  );
  const query = useApiQuery(fetcher);

  const fields: FilterField[] = useMemo(
    () => [
      { name: 'from', label: t('filters.from'), type: 'date' },
      { name: 'to', label: t('filters.to'), type: 'date' },
      {
        name: 'vehicleNumber',
        label: t('user.history.vehicle'),
        type: 'select',
        options: (vehicles.status === 'success' ? vehicles.data : []).map((vehicle) => ({
          value: vehicle.vehicleNumber,
          label: vehicle.vehicleNumber,
        })),
      },
      {
        name: 'vehicleType',
        label: t('parking.common.vehicleType'),
        type: 'select',
        options: VEHICLE_TYPES.map((value) => ({ value, label: t(`vehicleTypes.${value}`) })),
      },
    ],
    [t, vehicles],
  );

  return (
    <>
      <PageHeader title={t('user.history.title')} description={t('user.history.description')} />
      <div className="space-y-6">
        <FilterBar
          fields={fields}
          schema={portalHistoryQuerySchema}
          values={filters}
          onApply={setFilters}
          onReset={() => setFilters({})}
        />
        {query.status === 'loading' && <LoadingState />}
        {query.status === 'error' && (
          <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
        )}
        {query.status === 'success' &&
          (query.data.total === 0 ? (
            <EmptyState
              icon={History}
              title={t('user.history.empty')}
              description={
                Object.keys(filters).length > 0 ? t('user.history.emptyFiltered') : undefined
              }
            />
          ) : (
            <>
              <ul className="divide-y rounded-xl border bg-card px-2 md:hidden">
                {query.data.items.map((item) => (
                  <li key={item.sessionNumber}>
                    <SessionRow item={item} to={userPaths.session(item.sessionNumber)} />
                  </li>
                ))}
              </ul>
              <div className="hidden rounded-xl border bg-card px-2 md:block">
                <HistoryTable items={query.data.items} />
              </div>
              <Pager
                page={query.data.page}
                pageSize={query.data.pageSize}
                total={query.data.total}
                onPage={setPage}
              />
            </>
          ))}
      </div>
    </>
  );
}

function HistoryTable({ items }: { items: HistoryItem[] }) {
  const { t } = useTranslation();
  const format = useFormatters();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('user.history.date')}</TableHead>
          <TableHead>{t('user.history.vehicle')}</TableHead>
          <TableHead>{t('parking.common.block')}</TableHead>
          <TableHead>{t('parking.common.slot')}</TableHead>
          <TableHead>{t('parking.common.entry')}</TableHead>
          <TableHead>{t('parking.common.exit')}</TableHead>
          <TableHead>{t('parking.common.duration')}</TableHead>
          <TableHead className="text-right">{t('history.fee')}</TableHead>
          <TableHead>{t('parking.common.status')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.sessionNumber} className="relative">
            <TableCell className="whitespace-nowrap">
              <Link
                to={userPaths.session(item.sessionNumber)}
                className="font-medium text-primary underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:underline"
              >
                {format.date(item.entryAt)}
              </Link>
            </TableCell>
            <TableCell>
              <PlateBadge value={item.vehicleNumber} className="text-xs" />
            </TableCell>
            <TableCell>{item.blockName}</TableCell>
            <TableCell className="font-semibold" translate="no">
              {item.slotCode}
            </TableCell>
            <TableCell className="whitespace-nowrap tabular-nums">
              {formatHour(item.entryHour)}
            </TableCell>
            <TableCell className="whitespace-nowrap tabular-nums">
              {item.exitHour === null ? '—' : formatHour(item.exitHour)}
            </TableCell>
            <TableCell>
              {item.durationHours === null
                ? '—'
                : t('parking.common.hours', { count: item.durationHours })}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {item.feePaise === null ? '—' : format.paise(item.feePaise)}
            </TableCell>
            <TableCell>
              <StatusBadge tone={item.status === 'ACTIVE' ? 'info' : 'neutral'}>
                {t(`parking.sessionStatus.${item.status}`)}
              </StatusBadge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
