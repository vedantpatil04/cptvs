import { CircleHelp, LogIn, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS } from '@/app/paths';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { H2, Muted } from '@/components/ui/typography';
import { branding } from '@/config/branding';
import { useAuth } from '@/features/auth/use-auth';
import { useApiQuery } from '@/hooks/use-api-query';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';

import { AvailabilityCard } from './AvailabilityCard';
import { FeeTable } from './FeeTable';
import { ParkingLocations } from './ParkingLocations';
import { fetchPublicOverview } from './public-api';

function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <H2 id={id}>{title}</H2>
          <Muted>{description}</Muted>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Public landing page. Shows only aggregate and general information: free
 * space counts, parking blocks, fee rules and help. No vehicle, slot,
 * session, payment or other operational records are requested or shown.
 */
export function PublicHomePage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const { state } = useAuth();
  const overview = useApiQuery(fetchPublicOverview);
  useDocumentTitle(branding.productName);

  const pending = overview.status === 'loading';
  const failed =
    overview.status === 'error' ? (
      <ErrorState description={errorMessage(t, overview.error)} onRetry={overview.refetch} />
    ) : null;

  return (
    <>
      {/* Hero */}
      <section className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-10 sm:px-6 sm:py-14">
          <div className="space-y-3">
            <p className="text-sm font-semibold tracking-widest text-sidebar-muted-foreground uppercase">
              {branding.shortName}
            </p>
            <h1 className="text-3xl leading-tight font-bold text-balance text-sidebar-accent-foreground sm:text-5xl">
              {branding.productName}
            </h1>
            <p className="text-lg font-medium">{branding.institutionName}</p>
            <p className="max-w-2xl text-sidebar-muted-foreground">{t('public.tagline')}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {state.status !== 'authenticated' && (
              <Button asChild size="lg" variant="inverse">
                <Link to={PATHS.login}>
                  <LogIn aria-hidden />
                  {t('public.loginButton')}
                </Link>
              </Button>
            )}
            <Button asChild size="lg" variant="inverseOutline">
              <Link to={PATHS.help}>
                <CircleHelp aria-hidden />
                {t('nav.help')}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl space-y-12 px-4 py-10 sm:px-6">
        <Section
          id="availability"
          title={t('public.availability.title')}
          description={t('public.availability.description')}
          action={
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {overview.status === 'success' && (
                <span>
                  {t('public.availability.lastUpdated', {
                    time: format.time(overview.data.generatedAt),
                  })}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={overview.refetch} disabled={pending}>
                <RefreshCw className={pending ? 'animate-spin' : undefined} aria-hidden />
                {t('public.availability.refresh')}
              </Button>
            </div>
          }
        >
          {pending && <LoadingState />}
          {failed}
          {overview.status === 'success' && (
            <div className="grid gap-4 sm:grid-cols-2">
              {overview.data.availability.map((entry) => (
                <AvailabilityCard key={entry.vehicleType} availability={entry} />
              ))}
            </div>
          )}
        </Section>

        <Section
          id="locations"
          title={t('public.locations.title')}
          description={t('public.locations.description')}
        >
          {pending && <LoadingState />}
          {failed}
          {overview.status === 'success' && (
            <ParkingLocations locations={overview.data.locations} />
          )}
        </Section>

        <Section
          id="fees"
          title={t('public.fees.title')}
          description={t('public.fees.description')}
        >
          {pending && <LoadingState />}
          {failed}
          {overview.status === 'success' &&
            (overview.data.feeSchedule ? (
              <Card className="py-2">
                <CardContent className="px-2 sm:px-4">
                  <FeeTable schedule={overview.data.feeSchedule} />
                </CardContent>
              </Card>
            ) : (
              <EmptyState icon={Wallet} title={t('public.fees.notConfigured')} />
            ))}
        </Section>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CircleHelp className="size-5 text-primary" aria-hidden />
                {t('public.helpCard.title')}
              </CardTitle>
              <CardDescription>{t('public.helpCard.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link to={PATHS.help}>{t('public.helpCard.action')}</Link>
              </Button>
            </CardContent>
          </Card>
          <div className="flex items-start gap-3 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
            <ShieldCheck className="size-5 shrink-0 text-success" aria-hidden />
            <p>{t('public.privacyNote')}</p>
          </div>
        </div>
      </div>
    </>
  );
}
