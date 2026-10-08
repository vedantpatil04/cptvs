import {
  userListQuerySchema,
  VERIFICATION_STATUSES,
  visitorListQuerySchema,
  type UserCounts,
  type UserListItem,
  type VisitorListItem,
} from '@cpvts/shared';
import { Users } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { areaPaths } from '@/app/paths';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { PlateBadge } from '@/components/parking/PlateBadge';
import { VerificationBadge } from '@/components/user/VerificationBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

import { adminApi } from './admin-api';
import { FilterBar, type FilterField } from './FilterBar';
import { Pager } from './Pager';
import { useFilterParams } from './use-filter-params';

const TABS = ['ALL', 'STUDENT', 'STAFF', 'VISITORS'] as const;
type Tab = (typeof TABS)[number];
const FILTER_KEYS = ['tab', 'q', 'verification', 'status'] as const;
const PAGE_SIZE = 20;
const adminPaths = areaPaths('ADMIN');

const adminUserPath = (id: string) => `/admin/users/${encodeURIComponent(id)}`;

const isTab = (value: string | undefined): value is Tab => TABS.includes(value as Tab);

/** Compact counts under the page title; plain typography instead of a grid of cards. */
function CountsStrip({ counts }: { counts: UserCounts }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const items = [
    { label: t('adminUsers.counts.students'), value: counts.students },
    { label: t('adminUsers.counts.staff'), value: counts.staff },
    { label: t('adminUsers.counts.visitors'), value: counts.visitorVehicles },
    { label: t('adminUsers.counts.pending'), value: counts.pendingVerification, emphasis: true },
    { label: t('adminUsers.counts.activeUsers'), value: counts.activeParkingUsers },
  ];
  return (
    <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 lg:grid-cols-5">
      {items.map(({ label, value, emphasis }) => (
        <div key={label} className="space-y-1 bg-card px-4 py-3.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd
            className={
              emphasis && value > 0
                ? 'text-2xl font-bold text-warning tabular-nums'
                : 'text-2xl font-bold tabular-nums'
            }
          >
            {format.number(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Admin user management: students, campus staff and visitors. */
export function UsersPage() {
  const { t } = useTranslation();
  const { filters, page, setFilters, setPage } = useFilterParams(FILTER_KEYS);
  const tab: Tab = isTab(filters.tab) ? filters.tab : 'ALL';
  const counts = useApiQuery(adminApi.userCounts);

  const withTab = (values: Record<string, string>) => ({ ...values, tab });

  return (
    <>
      <PageHeader title={t('adminUsers.title')} description={t('adminUsers.description')} />
      {counts.status === 'success' && <CountsStrip counts={counts.data} />}
      <Tabs value={tab} onValueChange={(next) => setFilters({ tab: next })}>
        <TabsList aria-label={t('adminUsers.title')}>
          {TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`adminUsers.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab} className="space-y-6">
          {tab === 'VISITORS' ? (
            <VisitorList
              filters={filters}
              page={page}
              onFilter={(values) => setFilters(withTab(values))}
              onPage={setPage}
            />
          ) : (
            <UserList
              tab={tab}
              filters={filters}
              page={page}
              onFilter={(values) => setFilters(withTab(values))}
              onPage={setPage}
            />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

interface ListProps {
  filters: Record<string, string>;
  page: number;
  onFilter: (values: Record<string, string>) => void;
  onPage: (page: number) => void;
}

function UserList({ tab, filters, page, onFilter, onPage }: ListProps & { tab: Tab }) {
  const { t } = useTranslation();
  const query = {
    kind: tab === 'ALL' ? undefined : tab,
    q: filters.q,
    verification: filters.verification,
    status: filters.status,
  };
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      adminApi.users({ ...query, page, pageSize: PAGE_SIZE } as never, signal),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, filters.q, filters.verification, filters.status, page],
  );
  const result = useApiQuery(fetcher);

  const fields: FilterField[] = [
    {
      name: 'q',
      label: t('adminUsers.search'),
      type: 'text',
      placeholder: t('adminUsers.searchHint'),
    },
    {
      name: 'verification',
      label: t('adminUsers.verification'),
      type: 'select',
      options: VERIFICATION_STATUSES.map((value) => ({
        value,
        label: t(`verification.status.${value}`),
      })),
    },
    {
      name: 'status',
      label: t('adminUsers.accountStatus'),
      type: 'select',
      options: (['ACTIVE', 'INACTIVE'] as const).map((value) => ({
        value,
        label: t(`adminUsers.accountStatuses.${value}`),
      })),
    },
  ];

  return (
    <>
      <FilterBar
        fields={fields}
        schema={userListQuerySchema}
        values={Object.fromEntries(Object.entries(filters).filter(([key]) => key !== 'tab'))}
        onApply={onFilter}
        onReset={() => onFilter({})}
      />
      {result.status === 'loading' && <LoadingState />}
      {result.status === 'error' && (
        <ErrorState description={errorMessage(t, result.error)} onRetry={result.refetch} />
      )}
      {result.status === 'success' &&
        (result.data.total === 0 ? (
          <EmptyState icon={Users} title={t('adminUsers.empty')} />
        ) : (
          <>
            <UserTable items={result.data.items} tab={tab} />
            <Pager
              page={result.data.page}
              pageSize={result.data.pageSize}
              total={result.data.total}
              onPage={onPage}
            />
          </>
        ))}
    </>
  );
}

function UserTable({ items, tab }: { items: UserListItem[]; tab: Tab }) {
  const { t } = useTranslation();
  const format = useFormatters();

  return (
    <div className="rounded-xl border bg-card px-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('adminUsers.name')}</TableHead>
            {tab === 'ALL' && <TableHead>{t('account.role')}</TableHead>}
            <TableHead>
              {tab === 'STAFF'
                ? t('adminUsers.staffId')
                : tab === 'STUDENT'
                  ? t('adminUsers.studentId')
                  : t('adminUsers.institutionalId')}
            </TableHead>
            <TableHead>{t('adminUsers.verification')}</TableHead>
            <TableHead>{t('adminUsers.accountStatus')}</TableHead>
            <TableHead className="text-right">{t('adminUsers.vehicles')}</TableHead>
            <TableHead>{t('adminUsers.currentParking')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('adminUsers.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <p className="font-medium">{item.fullName}</p>
                <p className="text-xs text-muted-foreground">
                  {item.parkingUser?.email ?? `@${item.username}`}
                </p>
              </TableCell>
              {tab === 'ALL' && (
                <TableCell>
                  {item.parkingUser
                    ? t(`ownerCategories.${item.parkingUser.category}`)
                    : t(`roles.${item.role}`)}
                </TableCell>
              )}
              <TableCell className="font-mono text-xs" translate="no">
                {item.parkingUser?.institutionalId ?? '—'}
              </TableCell>
              <TableCell>
                {item.parkingUser ? (
                  <VerificationBadge status={item.parkingUser.verificationStatus} />
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell>
                <StatusBadge tone={item.isActive ? 'success' : 'neutral'} dot>
                  {t(`adminUsers.accountStatuses.${item.isActive ? 'ACTIVE' : 'INACTIVE'}`)}
                </StatusBadge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {format.number(item.vehicleCount)}
              </TableCell>
              <TableCell>
                {item.currentParking ? (
                  <span className="text-sm">
                    <span className="font-semibold" translate="no">
                      {item.currentParking.slotCode}
                    </span>{' '}
                    <span className="text-muted-foreground">{item.currentParking.blockName}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t('adminUsers.notParked')}</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Link
                  to={adminUserPath(item.id)}
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {item.parkingUser?.verificationStatus === 'PENDING'
                    ? t('adminUsers.review')
                    : t('adminUsers.view')}
                  <span className="sr-only"> {item.fullName}</span>
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function VisitorList({ filters, page, onFilter, onPage }: ListProps) {
  const { t } = useTranslation();
  const fetcher = useCallback(
    (signal: AbortSignal) =>
      adminApi.visitors(
        { q: filters.q, status: filters.status, page, pageSize: PAGE_SIZE } as never,
        signal,
      ),
    [filters.q, filters.status, page],
  );
  const result = useApiQuery(fetcher);

  const fields: FilterField[] = [
    { name: 'q', label: t('adminUsers.visitorSearch'), type: 'text', placeholder: 'KA22AB1234' },
    {
      name: 'status',
      label: t('parking.common.status'),
      type: 'select',
      options: (['ACTIVE', 'COMPLETED'] as const).map((value) => ({
        value,
        label: t(`parking.sessionStatus.${value}`),
      })),
    },
  ];

  return (
    <>
      <p className="text-sm text-muted-foreground">{t('adminUsers.visitorsNote')}</p>
      <FilterBar
        fields={fields}
        schema={visitorListQuerySchema}
        values={Object.fromEntries(
          Object.entries(filters).filter(([key]) => key === 'q' || key === 'status'),
        )}
        onApply={onFilter}
        onReset={() => onFilter({})}
      />
      {result.status === 'loading' && <LoadingState />}
      {result.status === 'error' && (
        <ErrorState description={errorMessage(t, result.error)} onRetry={result.refetch} />
      )}
      {result.status === 'success' &&
        (result.data.total === 0 ? (
          <EmptyState icon={Users} title={t('adminUsers.noVisitors')} />
        ) : (
          <>
            <VisitorTable items={result.data.items} />
            <Pager
              page={result.data.page}
              pageSize={result.data.pageSize}
              total={result.data.total}
              onPage={onPage}
            />
          </>
        ))}
    </>
  );
}

function VisitorTable({ items }: { items: VisitorListItem[] }) {
  const { t } = useTranslation();
  const format = useFormatters();
  return (
    <div className="rounded-xl border bg-card px-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('parking.common.vehicleNumber')}</TableHead>
            <TableHead>{t('parking.common.vehicleType')}</TableHead>
            <TableHead>{t('parking.common.sessionNumber')}</TableHead>
            <TableHead>{t('parking.common.block')}</TableHead>
            <TableHead>{t('parking.common.slot')}</TableHead>
            <TableHead>{t('parking.common.entry')}</TableHead>
            <TableHead className="text-right">{t('history.fee')}</TableHead>
            <TableHead>{t('parking.common.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.sessionNumber}>
              <TableCell>
                <PlateBadge value={item.vehicleNumber} className="text-xs" />
              </TableCell>
              <TableCell>{t(`vehicleTypes.${item.vehicleType}`)}</TableCell>
              <TableCell>
                <Link
                  to={adminPaths.session(item.sessionNumber)}
                  className="font-mono text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  {item.sessionNumber}
                </Link>
              </TableCell>
              <TableCell>{item.blockName}</TableCell>
              <TableCell className="font-semibold" translate="no">
                {item.slotCode}
              </TableCell>
              <TableCell className="whitespace-nowrap">{format.dateTime(item.entryAt)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {item.feePaise === null ? '—' : format.paise(item.feePaise)}
              </TableCell>
              <TableCell>
                <StatusBadge
                  tone={item.status === 'ACTIVE' ? 'info' : 'success'}
                  dot={item.status === 'ACTIVE'}
                >
                  {t(`parking.sessionStatus.${item.status}`)}
                </StatusBadge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
