import type { PublicAvailability } from '@cpvts/shared';
import {
  ArrowRight,
  CircleHelp,
  ClipboardCheck,
  LogIn,
  MapPinned,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Ticket,
  UserPlus,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS, registerPath } from '@/app/paths';
import { ImageSlot } from '@/components/branding/ImageSlot';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { H2, Muted } from '@/components/ui/typography';
import { branding } from '@/config/branding';
import { useAuth } from '@/features/auth/use-auth';
import { useApiQuery } from '@/hooks/use-api-query';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import type { TranslationCatalogue } from '@/i18n/resources';

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
    <section aria-labelledby={id} className="space-y-5">
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

type FaqKey = keyof TranslationCatalogue['help']['questions'];
const HOME_FAQ: FaqKey[] = ['availability', 'fees', 'vehicle'];

const STEPS: { key: 'register' | 'park' | 'find' | 'leave'; icon: LucideIcon }[] = [
  { key: 'register', icon: ClipboardCheck },
  { key: 'park', icon: Ticket },
  { key: 'find', icon: MapPinned },
  { key: 'leave', icon: Receipt },
];

/** Compact live figures on the hero photo. Counts only, as everywhere on the public page. */
function HeroAvailability({ availability }: { availability: PublicAvailability[] }) {
  const { t } = useTranslation();
  const format = useFormatters();
  return (
    <dl className="grid grid-cols-2 divide-x rounded-xl border bg-background/95 shadow-sm backdrop-blur">
      {availability.map((entry) => (
        <div key={entry.vehicleType} className="px-4 py-3">
          <dt className="text-xs text-muted-foreground">
            {t(`vehicleTypes.${entry.vehicleType}`)}
          </dt>
          <dd className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tabular-nums">
              {entry.totalSlots > 0 ? format.number(entry.availableSlots) : '—'}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('user.availability.available')}
            </span>
          </dd>
        </div>
      ))}
    </dl>
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
  const overview = useApiQuery(fetchPublicOverview, { refreshIntervalMs: 60_000 });
  useDocumentTitle(branding.productName);

  const pending = overview.status === 'loading';
  const failed =
    overview.status === 'error' ? (
      <ErrorState description={errorMessage(t, overview.error)} onRetry={overview.refetch} />
    ) : null;
  const signedIn = state.status === 'authenticated';

  return (
    <>
      {/* Hero */}
      <section className="border-b bg-secondary/40">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14 lg:py-16">
          <div className="space-y-6">
            <div className="space-y-4">
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                {branding.shortName} · {branding.institutionName}
              </p>
              <h1 className="text-4xl leading-[1.1] font-bold tracking-tight text-balance sm:text-5xl">
                {t('public.hero.title')}
              </h1>
              <p className="max-w-xl text-lg text-muted-foreground">{t('public.tagline')}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {!signedIn && (
                <>
                  <Button asChild size="lg">
                    <Link to={PATHS.userLogin}>
                      <LogIn aria-hidden />
                      {t('public.loginButton')}
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link to={registerPath('student')}>
                      <UserPlus aria-hidden />
                      {t('public.register')}
                    </Link>
                  </Button>
                </>
              )}
              <Button asChild size="lg" variant="outline">
                <Link to={PATHS.visitor.root}>
                  <Ticket aria-hidden />
                  {t('public.visitorButton')}
                </Link>
              </Button>
            </div>
          </div>
          <div className="relative">
            <div className="aspect-[4/3] overflow-hidden rounded-2xl border shadow-sm">
              <ImageSlot slot="hero" alt={t('public.hero.imageAlt')} />
            </div>
            {overview.status === 'success' && (
              <div className="absolute inset-x-4 -bottom-5 sm:inset-x-8">
                <HeroAvailability availability={overview.data.availability} />
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl space-y-16 px-4 py-14 sm:px-6">
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

        <Section id="how" title={t('public.how.title')} description={t('public.how.description')}>
          <ol className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ key, icon: Icon }, index) => (
              <li key={key} className="space-y-3 bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <Icon className="size-5 text-muted-foreground" aria-hidden />
                </div>
                <h3 className="font-semibold">{t(`public.how.steps.${key}.title`)}</h3>
                <p className="text-sm text-muted-foreground">{t(`public.how.steps.${key}.text`)}</p>
              </li>
            ))}
          </ol>
        </Section>

        <section
          aria-labelledby="visitor-parking"
          className="grid gap-6 rounded-2xl bg-sidebar p-6 text-sidebar-foreground sm:p-8 md:grid-cols-[1fr_auto] md:items-center"
        >
          <div className="space-y-2">
            <h2
              id="visitor-parking"
              className="text-xl font-semibold text-sidebar-accent-foreground"
            >
              {t('public.visitor.title')}
            </h2>
            <p className="max-w-2xl text-sidebar-muted-foreground">{t('public.visitor.text')}</p>
          </div>
          <Button asChild size="lg" variant="inverse">
            <Link to={PATHS.visitor.root}>
              {t('public.visitorButton')}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </section>

        <Section id="faq" title={t('help.title')} description={t('help.description')}>
          <div className="divide-y rounded-xl border bg-card">
            {HOME_FAQ.map((key) => (
              <details
                key={key}
                className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t(`help.questions.${key}.question`)}
                  <ArrowRight
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                    aria-hidden
                  />
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">
                  {t(`help.questions.${key}.answer`)}
                </p>
              </details>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Button asChild variant="outline">
              <Link to={PATHS.help}>
                <CircleHelp aria-hidden />
                {t('public.helpCard.action')}
              </Link>
            </Button>
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              {t('public.privacyNote')}
            </p>
          </div>
        </Section>
      </div>
    </>
  );
}
