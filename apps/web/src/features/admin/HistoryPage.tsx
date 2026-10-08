import {
  historyFilterSchema,
  OWNER_CATEGORIES,
  VEHICLE_TYPES,
  type HistoryItem,
} from '@cpvts/shared';
import { History } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { areaPaths } from '@/app/paths';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
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

import { adminApi } from './admin-api';
import { FilterBar, type FilterField } from './FilterBar';
import { Pager } from './Pager';
import { useFilterParams } from './use-filter-params';

const FILTER_KEYS = [
  'vehicleNumber',
  'slotCode',
  'vehicleType',
  'ownerCategory',
  'status',
  'from',
  'to',
] as const;
const PAGE_SIZE = 25;
const paths = areaPaths('ADMIN');

/** Searchable parking history (Master Blueprint §24). */
export function HistoryPage() {
  const { t } = useTranslation();
  const { filters, page, setFilters, setPage } = useFilterParams(FILTER_KEYS);

  const fetcher = useCallback(
    (signal: AbortSignal) => adminApi.history({ ...filters, page, pageSize: PAGE_SIZE }, signal),
    [filters, page],
  );
  const query = useApiQuery(fetcher);

  const fields: FilterField[] = [
    {
      name: 'vehicleNumber',
      label: t('parking.common.vehicleNumber'),
      type: 'text',
      placeholder: 'KA22AB1234',
    },
    { name: 'slotCode', label: t('parking.common.slot'), type: 'text', placeholder: 'T-01' },
    {
      name: 'vehicleType',
      label: t('parking.common.vehicleType'),
      type: 'select',
      options: VEHICLE_TYPES.map((value) => ({ value, label: t(`vehicleTypes.${value}`) })),
    },
    {
      name: 'ownerCategory',
      label: t('parking.common.ownerCategory'),
      type: 'select',
      options: OWNER_CATEGORIES.map((value) => ({ value, label: t(`ownerCategories.${value}`) })),
    },
    {
      name: 'status',
      label: t('parking.common.status'),
      type: 'select',
      options: (['ACTIVE', 'COMPLETED'] as const).map((value) => ({
        value,
        label: t(`parking.sessionStatus.${value}`),
      })),
    },
    { name: 'from', label: t('filters.from'), type: 'date' },
    { name: 'to', label: t('filters.to'), type: 'date' },
  ];

  return (
    <>
      <PageHeader title={t('history.title')} description={t('history.description')} />
      <div className="space-y-6">
        <Card>
          <CardContent>
            <FilterBar
              fields={fields}
              schema={historyFilterSchema}
              values={filters}
              onApply={setFilters}
              onReset={() => setFilters({})}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            {query.status === 'loading' && <LoadingState />}
            {query.status === 'error' && (
              <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
            )}
            {query.status === 'success' &&
              (query.data.total === 0 ? (
                <EmptyState icon={History} title={t('history.empty')} />
              ) : (
                <>
                  <HistoryTable items={query.data.items} />
                  <Pager
                    page={query.data.page}
                    pageSize={query.data.pageSize}
                    total={query.data.total}
                    onPage={setPage}
                  />
                </>
              ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function HistoryTable({ items }: { items: HistoryItem[] }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const linkClass = 'font-mono text-xs font-medium text-primary underline-offset-4 hover:underline';

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('parking.common.sessionNumber')}</TableHead>
          <TableHead>{t('parking.common.vehicleNumber')}</TableHead>
          <TableHead>{t('parking.common.vehicleType')}</TableHead>
          <TableHead>{t('parking.common.ownerCategory')}</TableHead>
          <TableHead>{t('parking.common.slot')}</TableHead>
          <TableHead>{t('parking.common.entry')}</TableHead>
          <TableHead>{t('parking.common.exit')}</TableHead>
          <TableHead>{t('parking.common.duration')}</TableHead>
          <TableHead className="text-right">{t('history.fee')}</TableHead>
          <TableHead>{t('parking.common.status')}</TableHead>
          <TableHead>{t('history.receipt')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.sessionNumber}>
            <TableCell>
              <Link to={paths.session(item.sessionNumber)} className={linkClass}>
                {item.sessionNumber}
              </Link>
            </TableCell>
            <TableCell className="font-mono font-medium">{item.vehicleNumber}</TableCell>
            <TableCell>{t(`vehicleTypes.${item.vehicleType}`)}</TableCell>
            <TableCell>{t(`ownerCategories.${item.ownerCategory}`)}</TableCell>
            <TableCell className="font-semibold">{item.slotCode}</TableCell>
            <TableCell className="whitespace-nowrap">
              {format.date(item.entryAt)} · {formatHour(item.entryHour)}
            </TableCell>
            <TableCell className="whitespace-nowrap">
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
              <StatusBadge tone={item.status === 'ACTIVE' ? 'info' : 'success'}>
                {t(`parking.sessionStatus.${item.status}`)}
              </StatusBadge>
            </TableCell>
            <TableCell>
              {item.receiptNumber ? (
                <Link to={paths.receipt(item.receiptNumber)} className={linkClass}>
                  {item.receiptNumber}
                </Link>
              ) : (
                '—'
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
