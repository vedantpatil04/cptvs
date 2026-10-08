import { CircleCheck, CircleX, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

/** Parking Integrity Engine report (Master Blueprint §18): read-only consistency checks. */
export function IntegrityPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const query = useApiQuery(adminApi.integrity);

  return (
    <>
      <PageHeader
        title={t('integrity.title')}
        description={t('integrity.description')}
        actions={
          <Button variant="outline" onClick={query.refetch}>
            <RefreshCw aria-hidden />
            {t('integrity.runAgain')}
          </Button>
        }
      />
      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}
      {query.status === 'success' && (
        <div className="space-y-6">
          {query.data.healthy ? (
            <Alert variant="success">
              <ShieldCheck aria-hidden />
              <AlertTitle>{t('integrity.healthy')}</AlertTitle>
              <AlertDescription>
                {t('integrity.checkedAt', { time: format.dateTime(query.data.checkedAt) })}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <ShieldAlert aria-hidden />
              <AlertTitle>{t('integrity.unhealthy')}</AlertTitle>
              <AlertDescription>
                {t('integrity.checkedAt', { time: format.dateTime(query.data.checkedAt) })}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('integrity.checksTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {query.data.checks.map((check) => (
                  <li key={check.code} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    {check.passed ? (
                      <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                    ) : (
                      <CircleX className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-medium">{t(`integrity.checks.${check.code}`)}</p>
                      {check.findings.length > 0 && (
                        <ul className="space-y-0.5 font-mono text-xs break-all text-muted-foreground">
                          {check.findings.map((finding) => (
                            <li key={finding}>{finding}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <StatusBadge tone={check.passed ? 'success' : 'danger'}>
                      {t(check.passed ? 'integrity.passed' : 'integrity.failed')}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('integrity.rejectionsTitle')}</CardTitle>
              <CardDescription>{t('integrity.rejectionsDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              {query.data.recentRejections.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('integrity.noRejections')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('audit.time')}</TableHead>
                      <TableHead>{t('integrity.rule')}</TableHead>
                      <TableHead>{t('audit.actor')}</TableHead>
                      <TableHead>{t('audit.entity')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data.recentRejections.map((rejection, index) => (
                      <TableRow key={`${rejection.at}-${index}`}>
                        <TableCell className="whitespace-nowrap">
                          {format.dateTime(rejection.at)}
                        </TableCell>
                        <TableCell>
                          <span className="block">
                            {t(`errors.${rejection.code}` as never, {
                              defaultValue: rejection.code,
                            })}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {rejection.code}
                          </span>
                        </TableCell>
                        <TableCell>{rejection.actor ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {rejection.entityType
                            ? `${rejection.entityType} ${rejection.entityId ?? ''}`
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
