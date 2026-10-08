import type { ParkingSessionView } from '@cpvts/shared';
import { ArrowRight, CircleParking, MapPinned, ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS, userPaths } from '@/app/paths';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { BlockMapLink } from '@/components/parking/BlockMapLink';
import { AvailabilityStrip } from '@/components/user/AvailabilityStrip';
import { CurrentParkingPanel } from '@/components/user/CurrentParkingPanel';
import { SessionRow } from '@/components/user/SessionRow';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useApiQuery } from '@/hooks/use-api-query';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { errorMessage } from '@/lib/error-message';

import { userApi } from './user-api';

const REFRESH_MS = 30_000;

const greetingKey = (hour: number) =>
  hour < 12 ? 'user.home.morning' : hour < 17 ? 'user.home.afternoon' : 'user.home.evening';

export function Section({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <h2
          id={id}
          className="text-xs font-semibold tracking-widest text-muted-foreground uppercase"
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Actions under a parked vehicle, on the dark panel. */
export function ParkedActions({ session }: { session: ParkingSessionView }) {
  const { t } = useTranslation();
  return (
    <>
      <Button asChild variant="inverse">
        <Link to={userPaths.locate(session.sessionNumber)}>
          <MapPinned aria-hidden />
          {t('user.actions.locate')}
        </Link>
      </Button>
      <Button asChild variant="inverseOutline">
        <Link to={userPaths.session(session.sessionNumber)}>
          <ScrollText aria-hidden />
          {t('user.actions.viewSession')}
        </Link>
      </Button>
      <BlockMapLink
        inverse
        size="default"
        coordinates={session.block.coordinates}
        label={t('user.actions.openBlockInMaps')}
      />
    </>
  );
}

/** Home: current parking first, then availability and recent activity. */
export function UserHomePage() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const overview = useApiQuery(userApi.overview, { refreshIntervalMs: REFRESH_MS });
  useDocumentTitle(t('nav.home'));

  const firstName = user.fullName.split(/\s+/)[0] ?? user.fullName;

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          {t(greetingKey(new Date().getHours()))}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{firstName}</h1>
      </header>

      {overview.status === 'loading' && <LoadingState />}
      {overview.status === 'error' && (
        <ErrorState description={errorMessage(t, overview.error)} onRetry={overview.refetch} />
      )}
      {overview.status === 'success' && (
        <>
          <Section id="home-current" title={t('user.home.currentParking')}>
            {overview.data.activeSessions.length === 0 ? (
              <EmptyState
                icon={CircleParking}
                title={t('user.home.notParkedTitle')}
                description={
                  overview.data.vehicleCount === 0
                    ? t('user.home.noVehicleHint')
                    : t('user.home.notParkedHint')
                }
                action={
                  <Button asChild variant="outline">
                    <Link
                      to={
                        overview.data.vehicleCount === 0
                          ? PATHS.user.vehicles
                          : PATHS.user.availability
                      }
                    >
                      {overview.data.vehicleCount === 0
                        ? t('user.vehicles.add')
                        : t('user.home.seeAvailability')}
                    </Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {overview.data.activeSessions.map((session) => (
                  <CurrentParkingPanel
                    key={session.sessionNumber}
                    session={session}
                    actions={<ParkedActions session={session} />}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section
            id="home-availability"
            title={t('user.home.liveAvailability')}
            action={
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link to={PATHS.user.availability}>
                  {t('user.home.viewLayout')}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            }
          >
            <AvailabilityStrip
              figures={overview.data.availability.map((entry) => ({
                vehicleType: entry.vehicleType,
                available: entry.availableSlots,
                total: entry.totalSlots,
              }))}
            />
          </Section>

          <Section
            id="home-recent"
            title={t('user.home.recentActivity')}
            action={
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link to={PATHS.user.history}>
                  {t('user.home.viewHistory')}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            }
          >
            {overview.data.recentActivity.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {t('user.home.noActivity')}
              </p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card px-2">
                {overview.data.recentActivity.map((item) => (
                  <li key={item.sessionNumber}>
                    <SessionRow item={item} to={userPaths.session(item.sessionNumber)} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
