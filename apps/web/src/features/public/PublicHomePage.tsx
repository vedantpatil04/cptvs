import {
  ArrowDown,
  ArrowRight,
  CircleHelp,
  Languages,
  ParkingCircle,
  QrCode,
  Receipt,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Wallet,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS } from '@/app/paths';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
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
 * Public landing page. Communicates CPVTS as a real, complete campus parking product.
 * Aggregate-only data: spaces available, locations, fees, how it works, and key benefits.
 * No private user or vehicle data is exposed.
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
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-sidebar via-sidebar to-sidebar/95 text-sidebar-foreground border-b border-sidebar-border">
        {/* Subtle grid accent */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />

        <div className="relative mx-auto w-full max-w-6xl space-y-8 px-4 py-12 sm:px-6 sm:py-20">
          <div className="space-y-4 max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-accent/30 px-3 py-1 text-xs font-semibold text-sidebar-accent-foreground backdrop-blur-xs">
              <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{branding.shortName} · Smart Campus Parking Platform</span>
            </div>

            <h1 className="text-4xl leading-tight font-extrabold tracking-tight text-balance text-sidebar-accent-foreground sm:text-6xl">
              {branding.productName}
            </h1>

            <p className="text-xl font-medium text-sidebar-foreground/90">
              {branding.institutionName}
            </p>

            <p className="text-base text-sidebar-muted-foreground leading-relaxed sm:text-lg">
              {t('public.tagline')}
            </p>
          </div>

          {/* Quick Action Navigation Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-2">
            <a
              href="#availability"
              className="flex items-center justify-between p-4 rounded-xl border border-sidebar-border/80 bg-sidebar-accent/20 hover:bg-sidebar-accent/40 text-sidebar-foreground transition-all hover:scale-[1.01] group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-primary/20 text-primary">
                  <ArrowDown className="size-5" />
                </div>
                <div>
                  <span className="text-sm font-bold block">{t('public.checkAvailability')}</span>
                  <span className="text-xs text-sidebar-muted-foreground">Live bay status</span>
                </div>
              </div>
              <ArrowRight className="size-4 text-sidebar-muted-foreground group-hover:translate-x-1 transition-transform" />
            </a>

            <Link
              to={state.status === 'authenticated' ? PATHS.portal.root : PATHS.login}
              className="flex items-center justify-between p-4 rounded-xl border border-sidebar-border/80 bg-sidebar-accent/20 hover:bg-sidebar-accent/40 text-sidebar-foreground transition-all hover:scale-[1.01] group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <UserCheck className="size-5" />
                </div>
                <div>
                  <span className="text-sm font-bold block">{t('public.portalLogin')}</span>
                  <span className="text-xs text-sidebar-muted-foreground">Students & Staff</span>
                </div>
              </div>
              <ArrowRight className="size-4 text-sidebar-muted-foreground group-hover:translate-x-1 transition-transform" />
            </Link>

            <Link
              to={PATHS.visitor.root}
              className="flex items-center justify-between p-4 rounded-xl border border-sidebar-border/80 bg-sidebar-accent/20 hover:bg-sidebar-accent/40 text-sidebar-foreground transition-all hover:scale-[1.01] group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-amber-500/20 text-amber-400">
                  <ParkingCircle className="size-5" />
                </div>
                <div>
                  <span className="text-sm font-bold block">{t('public.visitorAccess')}</span>
                  <span className="text-xs text-sidebar-muted-foreground">Slip & QR Pass</span>
                </div>
              </div>
              <ArrowRight className="size-4 text-sidebar-muted-foreground group-hover:translate-x-1 transition-transform" />
            </Link>

            <Link
              to={PATHS.login}
              className="flex items-center justify-between p-4 rounded-xl border border-sidebar-border/80 bg-sidebar-accent/20 hover:bg-sidebar-accent/40 text-sidebar-foreground transition-all hover:scale-[1.01] group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-sky-500/20 text-sky-400">
                  <ShieldCheck className="size-5" />
                </div>
                <div>
                  <span className="text-sm font-bold block">{t('public.adminStaffLogin')}</span>
                  <span className="text-xs text-sidebar-muted-foreground">Security & Gate</span>
                </div>
              </div>
              <ArrowRight className="size-4 text-sidebar-muted-foreground group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <main className="flex-1 mx-auto w-full max-w-6xl space-y-16 px-4 py-12 sm:px-6">
        {/* Section 1: Live Parking Availability */}
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

        {/* Section 2: How CPVTS Works */}
        <section aria-labelledby="how-it-works" className="space-y-6">
          <div className="space-y-1 text-center max-w-2xl mx-auto">
            <H2 id="how-it-works">{t('public.howItWorksTitle')}</H2>
            <Muted>{t('public.howItWorksSubtitle')}</Muted>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
            <Card className="border-border shadow-xs hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
                  <UserCheck className="size-5" />
                </div>
                <CardTitle className="text-base font-bold">{t('public.step1Title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t('public.step1Desc')}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border shadow-xs hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 mb-2">
                  <Sparkles className="size-5" />
                </div>
                <CardTitle className="text-base font-bold">{t('public.step2Title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t('public.step2Desc')}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border shadow-xs hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex size-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 mb-2">
                  <QrCode className="size-5" />
                </div>
                <CardTitle className="text-base font-bold">{t('public.step3Title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t('public.step3Desc')}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border shadow-xs hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 mb-2">
                  <Receipt className="size-5" />
                </div>
                <CardTitle className="text-base font-bold">{t('public.step4Title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t('public.step4Desc')}
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Section 3: Parking Locations & Blocks */}
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

        {/* Section 4: Official Fee Table */}
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

        {/* Section 5: Key Platform Benefits */}
        <section aria-labelledby="key-benefits" className="space-y-6">
          <div className="space-y-1 text-center max-w-2xl mx-auto">
            <H2 id="key-benefits">{t('public.benefitsTitle')}</H2>
            <Muted>{t('public.benefitsSubtitle')}</Muted>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
            <div className="rounded-xl border bg-card p-5 space-y-2">
              <Scale className="size-6 text-primary" />
              <h4 className="font-bold text-sm">{t('public.b1Title')}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{t('public.b1Desc')}</p>
            </div>

            <div className="rounded-xl border bg-card p-5 space-y-2">
              <ShieldCheck className="size-6 text-emerald-600" />
              <h4 className="font-bold text-sm">{t('public.b2Title')}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{t('public.b2Desc')}</p>
            </div>

            <div className="rounded-xl border bg-card p-5 space-y-2">
              <Wallet className="size-6 text-amber-600" />
              <h4 className="font-bold text-sm">{t('public.b3Title')}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{t('public.b3Desc')}</p>
            </div>

            <div className="rounded-xl border bg-card p-5 space-y-2">
              <Languages className="size-6 text-sky-600" />
              <h4 className="font-bold text-sm">{t('public.b4Title')}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{t('public.b4Desc')}</p>
            </div>
          </div>
        </section>

        {/* Section 6: Help & Privacy */}
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
      </main>

      {/* Product Footer */}
      <footer className="border-t bg-muted/30 mt-16 text-xs text-muted-foreground">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-6">
            <div className="space-y-1">
              <span className="font-bold text-sm text-foreground">{branding.productName}</span>
              <p className="text-xs">{branding.institutionName} · {t('public.footerTagline')}</p>
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 text-[11px]">
            <div className="flex flex-wrap gap-4">
              <a href="#availability" className="hover:text-foreground">
                {t('public.availability.title')}
              </a>
              <a href="#locations" className="hover:text-foreground">
                {t('public.locations.title')}
              </a>
              <a href="#fees" className="hover:text-foreground">
                {t('public.fees.title')}
              </a>
              <Link to={PATHS.visitor.root} className="hover:text-foreground">
                {t('public.visitorAccess')}
              </Link>
              <Link to={PATHS.help} className="hover:text-foreground">
                {t('nav.help')}
              </Link>
              <Link to={PATHS.login} className="hover:text-foreground">
                {t('auth.signIn')}
              </Link>
              <Link to={PATHS.register.student} className="hover:text-foreground">
                Register Student
              </Link>
            </div>
            <span>
              © {new Date().getFullYear()} {branding.institutionName}. {t('public.footerCopyright')}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
