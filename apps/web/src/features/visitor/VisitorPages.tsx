import { visitorAccessRequestSchema, type VisitorAccessRequest } from '@cpvts/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, LoaderCircle, ReceiptText, ScrollText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';

import { PATHS } from '@/app/paths';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { SessionFacts } from '@/features/user/MyParkingPage';
import { LocateView } from '@/features/user/LocatePage';
import { ReceiptActions, ReceiptDocument } from '@/features/parking/ReceiptPage';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useApiQuery } from '@/hooks/use-api-query';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';

import { visitorApi } from './visitor-api';
import { useVisitor } from './visitor-session';

/** Re-runs a visitor request; an expired or invalid visitor token ends the visit. */
function useVisitorQuery<T>(
  request: (token: string, signal: AbortSignal) => Promise<T>,
  refreshIntervalMs?: number,
) {
  const { session, end } = useVisitor();
  const token = session?.accessToken ?? '';
  const fetcher = useCallback((signal: AbortSignal) => request(token, signal), [request, token]);
  const query = useApiQuery(fetcher, { refreshIntervalMs });

  useEffect(() => {
    if (query.status === 'error' && query.error instanceof ApiError && query.error.status === 401) {
      end();
    }
  }, [query.status, query.error, end]);
  return query;
}

type AccessValues = VisitorAccessRequest;

/** Visitor entry: prove you hold the parking slip. No account, no password. */
export function VisitorAccessPage() {
  const { t } = useTranslation();
  const { session, start } = useVisitor();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<unknown>(null);
  useDocumentTitle(t('visitor.accessTitle'));

  const form = useForm<AccessValues>({
    resolver: zodResolver(visitorAccessRequestSchema),
    defaultValues: { vehicleNumber: '', sessionNumber: '' },
  });

  if (session) return <Navigate to={PATHS.visitor.parking} replace />;

  const onSubmit = async (values: AccessValues) => {
    setSubmitError(null);
    try {
      const result = await visitorApi.access(values);
      start({ accessToken: result.accessToken, expiresAt: result.expiresAt });
      void navigate(PATHS.visitor.parking);
    } catch (error) {
      setSubmitError(error);
    }
  };
  const submitting = form.formState.isSubmitting;

  return (
    <div className="mx-auto max-w-md space-y-6 py-4">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          {t('visitor.accessTitle')}
        </h1>
        <p className="text-muted-foreground">{t('visitor.accessDescription')}</p>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5" noValidate>
          {submitError !== null && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{errorMessage(t, submitError)}</AlertDescription>
            </Alert>
          )}
          <FormField
            control={form.control}
            name="vehicleNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('parking.common.vehicleNumber')}</FormLabel>
                <FormControl>
                  <Input
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t('parking.entry.vehicleNumberPlaceholder')}
                    className="font-mono uppercase placeholder:normal-case"
                    autoFocus
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sessionNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('parking.common.sessionNumber')}</FormLabel>
                <FormControl>
                  <Input
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="CPVTS-P-XXXXXXXX"
                    className="font-mono uppercase placeholder:normal-case"
                    {...field}
                  />
                </FormControl>
                <FormDescription>{t('visitor.slipHint')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
            {submitting ? t('visitor.checking') : t('visitor.viewParking')}
          </Button>
        </form>
      </Form>
      <p className="text-sm text-muted-foreground">{t('visitor.privacyNote')}</p>
    </div>
  );
}

/** The visitor's parking: found vehicle, exact slot on the layout, session details. */
export function VisitorParkingPage() {
  const { t } = useTranslation();
  const { session } = useVisitor();
  const parking = useVisitorQuery(visitorApi.session, 30_000);
  const layout = useVisitorQuery(visitorApi.layout, 30_000);

  if (!session) return <Navigate to={PATHS.visitor.root} replace />;

  return (
    <>
      <PageHeader title={t('visitor.parkingTitle')} description={t('visitor.parkingDescription')} />
      {parking.status === 'loading' && <LoadingState />}
      {parking.status === 'error' && (
        <ErrorState description={errorMessage(t, parking.error)} onRetry={parking.refetch} />
      )}
      {parking.status === 'success' && (
        <div className="space-y-10">
          <LocateView
            sessions={[parking.data]}
            layout={layout.status === 'success' ? layout.data : null}
            selected={parking.data.sessionNumber}
            extraActions={
              <>
                <Button asChild variant="inverseOutline">
                  <a href="#visitor-session">
                    <ScrollText aria-hidden />
                    {t('user.actions.viewSession')}
                  </a>
                </Button>
                {parking.data.receiptNumber ? (
                  <Button asChild variant="inverseOutline">
                    <Link to={PATHS.visitor.receipt}>
                      <ReceiptText aria-hidden />
                      {t('parking.common.viewReceipt')}
                    </Link>
                  </Button>
                ) : (
                  <Button variant="inverseOutline" disabled>
                    <ReceiptText aria-hidden />
                    {t('parking.common.viewReceipt')}
                  </Button>
                )}
              </>
            }
          />
          <section aria-labelledby="visitor-session" className="space-y-4">
            <h2
              id="visitor-session"
              className="flex scroll-mt-24 items-center gap-2 text-lg font-semibold"
            >
              <ScrollText className="size-5 text-primary" aria-hidden />
              {t('parking.session.title')}
            </h2>
            <SessionFacts session={parking.data} />
          </section>
        </div>
      )}
    </>
  );
}

/** The visitor's receipt, available once the visit has been paid. */
export function VisitorReceiptPage() {
  const { t } = useTranslation();
  const { session } = useVisitor();
  const receipt = useVisitorQuery(visitorApi.receipt);

  if (!session) return <Navigate to={PATHS.visitor.root} replace />;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={t('parking.receipt.title')}
          actions={
            <>
              <Button asChild variant="ghost">
                <Link to={PATHS.visitor.parking}>{t('visitor.parkingTitle')}</Link>
              </Button>
              {receipt.status === 'success' && <ReceiptActions receipt={receipt.data} />}
            </>
          }
        />
      </div>
      {receipt.status === 'loading' && <LoadingState />}
      {receipt.status === 'error' &&
        (receipt.error instanceof ApiError && receipt.error.code === 'RECEIPT_NOT_FOUND' ? (
          <ErrorState
            title={t('visitor.noReceiptTitle')}
            description={t('visitor.noReceiptHint')}
            onRetry={receipt.refetch}
          />
        ) : (
          <ErrorState description={errorMessage(t, receipt.error)} onRetry={receipt.refetch} />
        ))}
      {receipt.status === 'success' && <ReceiptDocument receipt={receipt.data} />}
    </>
  );
}
