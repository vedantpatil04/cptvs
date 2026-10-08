import {
  AUDIT_ACTION_CODES,
  AUDIT_ENTITY_TYPE_CODES,
  auditLogQuerySchema,
  type AuditLogEntry,
} from '@cpvts/shared';
import { ScrollText } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
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

import { adminApi } from './admin-api';
import { FilterBar, type FilterField } from './FilterBar';
import { Pager } from './Pager';
import { useFilterParams } from './use-filter-params';

const FILTER_KEYS = ['action', 'entityType', 'entityId', 'actor', 'from', 'to'] as const;
const PAGE_SIZE = 50;

/** Read-only audit trail with filters (Master Blueprint §38). */
export function AuditLogPage() {
  const { t } = useTranslation();
  const { filters, page, setFilters, setPage } = useFilterParams(FILTER_KEYS);

  const fetcher = useCallback(
    (signal: AbortSignal) => adminApi.auditLogs({ ...filters, page, pageSize: PAGE_SIZE }, signal),
    [filters, page],
  );
  const query = useApiQuery(fetcher);

  const fields: FilterField[] = [
    {
      name: 'action',
      label: t('audit.action'),
      type: 'select',
      options: AUDIT_ACTION_CODES.map((value) => ({
        value,
        label: t(`audit.actions.${value}`),
      })),
    },
    {
      name: 'entityType',
      label: t('audit.entityType'),
      type: 'select',
      options: AUDIT_ENTITY_TYPE_CODES.map((value) => ({
        value,
        label: t(`audit.entityTypes.${value}`),
      })),
    },
    {
      name: 'entityId',
      label: t('audit.entityId'),
      type: 'text',
      placeholder: 'CPVTS-P-…',
    },
    { name: 'actor', label: t('audit.actorUsername'), type: 'text', placeholder: 'admin' },
    { name: 'from', label: t('filters.from'), type: 'date' },
    { name: 'to', label: t('filters.to'), type: 'date' },
  ];

  return (
    <>
      <PageHeader title={t('audit.title')} description={t('audit.description')} />
      <div className="space-y-6">
        <Card>
          <CardContent>
            <FilterBar
              fields={fields}
              schema={auditLogQuerySchema}
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
                <EmptyState icon={ScrollText} title={t('audit.empty')} />
              ) : (
                <>
                  <AuditTable entries={query.data.items} />
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

function AuditTable({ entries }: { entries: AuditLogEntry[] }) {
  const { t } = useTranslation();
  const format = useFormatters();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('audit.time')}</TableHead>
          <TableHead>{t('audit.action')}</TableHead>
          <TableHead>{t('audit.actor')}</TableHead>
          <TableHead>{t('audit.entity')}</TableHead>
          <TableHead>{t('audit.details')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id} className="align-top">
            <TableCell className="whitespace-nowrap">{format.dateTime(entry.at)}</TableCell>
            <TableCell>
              <span className="block font-medium">
                {t(`audit.actions.${entry.action}` as never, { defaultValue: entry.action })}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{entry.action}</span>
            </TableCell>
            <TableCell>
              {entry.actor ? (
                <>
                  <span className="block">{entry.actor.fullName}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry.actor.username} · {t(`roles.${entry.actor.role}`)}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">{t('audit.system')}</span>
              )}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {entry.entityType ? (
                <>
                  <span className="block">{entry.entityType}</span>
                  <span className="break-all text-muted-foreground">{entry.entityId}</span>
                </>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell className="max-w-80">
              {entry.metadata && Object.keys(entry.metadata).length > 0 ? (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    {t('audit.showDetails')}
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 text-xs">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                  {entry.ipAddress && (
                    <p className="mt-1 text-xs text-muted-foreground">IP {entry.ipAddress}</p>
                  )}
                </details>
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
