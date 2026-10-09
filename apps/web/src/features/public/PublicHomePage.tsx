import type { PublicBlockAvailability, PublicOverviewResponse, VehicleType } from '@cpvts/shared';
import { Bike, Car, LogIn, ParkingCircle, RefreshCw, Ticket } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS, ROLE_HOME } from '@/app/paths';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { BlockMapLink } from '@/components/parking/BlockMapLink';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { branding } from '@/config/branding';
import { useAuth } from '@/features/auth/use-auth';
import { useApiQuery } from '@/hooks/use-api-query';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';

import { FeeTable } from './FeeTable';
import { fetchPublicOverview } from './public-api';

const TYPE_ICON = { TWO_WHEELER: Bike, FOUR_WHEELER: Car } as const;

function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id={id} className="text-2xl font-bold tracking-tight">
            {title}
          </h2>
          {description && <p className="max-w-2xl text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Free-space meter: a bar that is empty when the block is full. */
function Meter({ available, total }: { available: number; total: number }) {
  const share = total > 0 ? Math.round((available / total) * 100) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div
        className={cn('h-full rounded-full', available === 0 ? 'bg-destructive' : 'bg-brand')}
        style={{
          width: `${available === 0 ? 100 : Math.max(share, 4)}%`,
          opacity: available === 0 ? 0.25 : 1,
        }}
      />
    </div>
  );
}

function LiveTotals({ overview }: { overview: PublicOverviewResponse | undefined }) {
  const { t } = useTranslation();
  const format = useFormatters();
  return (
    <div className="grid grid-cols-2 gap-3" aria-label={t('public.hero.liveNow')}>
      {(overview?.availability ?? [null, null]).map((entry, index) => {
        const type: VehicleType =
          entry?.vehicleType ?? (index === 0 ? 'TWO_WHEELER' : 'FOUR_WHEELER');
        const Icon = TYPE_ICON[type];
        return (
          <div key={type} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="flex items-center gap-2 text-sm text-sidebar-foreground/80">
              <Icon className="size-4" aria-hidden />
              {t(`vehicleTypes.${type}`)}
            </p>
            <p className="mt-2 text-5xl leading-none font-extrabold tabular-nums text-white">
              {entry ? format.number(entry.availableSlots) : '–'}
            </p>
            <p className="mt-1.5 text-sm text-sidebar-foreground/70">
              {entry
                ? t('public.availability.ofTotal', { total: format.number(entry.totalSlots) })
                : t('common.loading')}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function BlockRow({
  row,
  overview,
}: {
  row: PublicBlockAvailability;
  overview: PublicOverviewResponse;
}) {
  const { t } = useTranslation();
  const format = useFormatters();
  const Icon = TYPE_ICON[row.vehicleType];
  const location = overview.locations.find((entry) => entry.code === row.blockCode);
  return (
    <li className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-semibold text-balance">{row.blockName}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Icon className="size-4 shrink-0" aria-hidden />
            {t(`vehicleTypes.${row.vehicleType}`)}
          </p>
        </div>
        <p className="shrink-0 text-right">
          <span className="block text-3xl leading-none font-bold tabular-nums">
            {format.number(row.availableSlots)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('public.availability.freeOfTotal', { total: format.number(row.totalSlots) })}
          </span>
        </p>
      </div>
      <Meter available={row.availableSlots} total={row.totalSlots} />
      <BlockMapLink coordinates={location?.coordinates ?? null} />
    </li>
  );
}

/**
 * Public landing page. The one thing a visitor can do here is park: "Park My Vehicle" opens the
 * guest flow, and the live free spaces (per block and vehicle category) come straight from the
 * server. No private user or vehicle data is exposed.
 */
export function PublicHomePage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const { state } = useAuth();
  const overview = useApiQuery(fetchPublicOverview, { refreshIntervalMs: 20_000 });
  useDocumentTitle(branding.productName);

  const signedIn = state.status === 'authenticated' ? state.user : null;
  const parkTo = signedIn
    ? signedIn.role === 'PARKING_USER'
      ? PATHS.portal.parkNow
      : ROLE_HOME[signedIn.role]
    : PATHS.visitor.park;
  const pending = overview.status === 'loading';
  const data = overview.status === 'success' ? overview.data : undefined;

  return (
    <div className="flex flex-col bg-background text-foreground">
      <section className="border-b border-white/10 bg-sidebar text-sidebar-foreground">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div className="space-y-5">
            <p className="text-sm font-medium tracking-wide text-emerald-300/90">
              {branding.institutionName}
            </p>
            <h1 className="text-4xl leading-[1.05] font-extrabold tracking-tight text-balance text-white sm:text-5xl lg:text-6xl">
              {t('public.hero.headline')}
            </h1>
            <p className="max-w-xl text-lg text-sidebar-foreground/80">{t('public.hero.body')}</p>
            <div className="flex flex-col gap-3 pt-1 sm:flex-row">
              <Button asChild variant="brand" size="lg" className="h-14 px-8 text-base">
                <Link to={parkTo}>
                  <ParkingCircle aria-hidden />
                  {t('parkMyVehicle.cta')}
                </Link>
              </Button>
              {!signedIn && (
                <Button asChild variant="inverseOutline" size="lg" className="h-14 px-6 text-base">
                  <Link to={PATHS.login}>
                    <LogIn aria-hidden />
                    {t('public.hero.studentStaff')}
                  </Link>
                </Button>
              )}
              {!signedIn && (
                <Button asChild variant="inverseOutline" size="lg" className="h-14 px-6 text-base">
                  <Link to={PATHS.visitor.root}>
                    <Ticket aria-hidden />
                    {t('public.hero.visitorPass')}
                  </Link>
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-sidebar-foreground/80">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
              </span>
              {t('public.hero.liveNow')}
            </p>
            <LiveTotals overview={data} />
          </div>
        </div>
      </section>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-14 px-4 py-10 sm:px-6 sm:py-14">
        <Section
          id="availability"
          title={t('public.availability.byBlockTitle')}
          description={t('public.availability.byBlockDescription')}
          action={
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {data && (
                <span>
                  {t('public.availability.lastUpdated', { time: format.time(data.generatedAt) })}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={overview.refetch} disabled={pending}>
                <RefreshCw className={pending ? 'animate-spin' : undefined} aria-hidden />
                {t('public.availability.refresh')}
              </Button>
            </div>
          }
        >
          {pending && <div className="h-40 animate-pulse rounded-xl border bg-muted" aria-hidden />}
          {overview.status === 'error' && (
            <ErrorState description={errorMessage(t, overview.error)} onRetry={overview.refetch} />
          )}
          {data &&
            (data.blockAvailability.length > 0 ? (
              <ul className="grid gap-3 lg:grid-cols-2">
                {data.blockAvailability.map((row) => (
                  <BlockRow key={`${row.blockCode}:${row.vehicleType}`} row={row} overview={data} />
                ))}
              </ul>
            ) : (
              <EmptyState icon={ParkingCircle} title={t('public.availability.notConfigured')} />
            ))}
        </Section>

        <Section
          id="fees"
          title={t('public.fees.title')}
          description={t('public.fees.description')}
        >
          {data?.feeSchedule ? (
            <Card className="py-2">
              <CardContent className="px-2 sm:px-4">
                <FeeTable schedule={data.feeSchedule} />
              </CardContent>
            </Card>
          ) : (
            data && <EmptyState icon={ParkingCircle} title={t('public.fees.notConfigured')} />
          )}
        </Section>

        <Section id="how-it-works" title={t('public.howItWorksTitle')}>
          <ol className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {(['step1', 'step2', 'step3', 'step4'] as const).map((step, index) => (
              <li key={step} className="space-y-1.5 bg-card p-5">
                <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {index + 1}
                </span>
                <h3 className="pt-1 font-semibold">{t(`public.${step}Title`)}</h3>
                <p className="text-sm text-muted-foreground">{t(`public.${step}Desc`)}</p>
              </li>
            ))}
          </ol>
        </Section>

        <p className="flex items-start gap-3 rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          {t('public.privacyNote')}
        </p>
      </main>

      <nav aria-label={t('nav.mainNavigation')} className="border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-5 text-sm text-muted-foreground sm:px-6">
          <span>
            © {new Date().getFullYear()} {branding.institutionName}. {t('public.footerCopyright')}
          </span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to={PATHS.help} className="hover:text-foreground">
              {t('nav.help')}
            </Link>
            <Link to={PATHS.login} className="hover:text-foreground">
              {t('auth.signIn')}
            </Link>
            <Link to={PATHS.register.student} className="hover:text-foreground">
              {t('public.hero.register')}
            </Link>
          </div>
        </div>
      </nav>
    </div>
  );
}
