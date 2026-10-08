import { reportQuerySchema, REPORT_KINDS, type ReportKind } from '@cpvts/shared';
import { CircleAlert, CircleCheck, Download, FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';

import { adminApi } from './admin-api';

type Status =
  | { state: 'idle' }
  | { state: 'downloading'; kind: ReportKind }
  | { state: 'done'; filename: string }
  | { state: 'error'; message: string };

/** Hands a downloaded blob to the browser as a file. */
const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** CSV exports (Master Blueprint §43). Amounts come from finalized transactions. */
export function ReportsPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState({ from: '', to: '' });
  const [status, setStatus] = useState<Status>({ state: 'idle' });

  const download = async (kind: ReportKind) => {
    const values = {
      ...(range.from && { from: range.from }),
      ...(range.to && { to: range.to }),
    };
    const parsed = reportQuerySchema.safeParse(values);
    if (!parsed.success) {
      setStatus({
        state: 'error',
        message: t((parsed.error.issues[0]?.message ?? 'validation.invalidDate') as never),
      });
      return;
    }
    setStatus({ state: 'downloading', kind });
    try {
      const { blob, filename } = await adminApi.downloadReport(kind, values);
      const name = filename ?? `cpvts-${kind}.csv`;
      saveBlob(blob, name);
      setStatus({ state: 'done', filename: name });
    } catch (error) {
      setStatus({ state: 'error', message: errorMessage(t, error) });
    }
  };

  return (
    <>
      <PageHeader title={t('reports.title')} description={t('reports.description')} />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('reports.rangeTitle')}</CardTitle>
            <CardDescription>{t('reports.rangeHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid max-w-xl gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="report-from">{t('filters.from')}</Label>
                <Input
                  id="report-from"
                  type="date"
                  value={range.from}
                  onChange={(event) => setRange({ ...range, from: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-to">{t('filters.to')}</Label>
                <Input
                  id="report-to"
                  type="date"
                  value={range.to}
                  onChange={(event) => setRange({ ...range, to: event.target.value })}
                />
              </div>
            </div>
            <div aria-live="polite">
              {status.state === 'error' && (
                <Alert variant="destructive">
                  <CircleAlert aria-hidden />
                  <AlertDescription>{status.message}</AlertDescription>
                </Alert>
              )}
              {status.state === 'done' && (
                <Alert variant="success">
                  <CircleCheck aria-hidden />
                  <AlertDescription>
                    {t('reports.downloaded', { file: status.filename })}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          {REPORT_KINDS.map((kind) => {
            const busy = status.state === 'downloading' && status.kind === kind;
            return (
              <Card key={kind}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileSpreadsheet className="size-5 text-muted-foreground" aria-hidden />
                    {t(`reports.kinds.${kind}.title`)}
                  </CardTitle>
                  <CardDescription>{t(`reports.kinds.${kind}.description`)}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    disabled={status.state === 'downloading'}
                    onClick={() => void download(kind)}
                  >
                    {busy ? (
                      <LoaderCircle className="animate-spin" aria-hidden />
                    ) : (
                      <Download aria-hidden />
                    )}
                    {t('reports.download')}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
