import type { ParkingSessionView, PortalLayoutResponse } from '@cpvts/shared';
import { CircleParking, Map as MapIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { PATHS } from '@/app/paths';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { BlockMapLink } from '@/components/parking/BlockMapLink';
import { CurrentParkingPanel } from '@/components/user/CurrentParkingPanel';
import { ParkingLayout } from '@/components/user/ParkingLayout';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';
import { formatHour } from '@/lib/format';
import { cn } from '@/lib/utils';

import { userApi } from './user-api';

interface LocateViewProps {
  sessions: ParkingSessionView[];
  layout: PortalLayoutResponse | null;
  selected: string | null;
  onSelect?: (sessionNumber: string) => void;
  /** Link to the full availability page (residents only). */
  availabilityLink?: boolean;
  /** More buttons for the dark panel (use the `inverse` variants). */
  extraActions?: ReactNode;
}

/**
 * "Vehicle found": the exact slot on the CPVTS layout plus the block on Google
 * Maps. Shared by Students / Staff and visitors, who differ only in where the
 * data comes from.
 */
export function LocateView({
  sessions,
  layout,
  selected,
  onSelect,
  availabilityLink,
  extraActions,
}: LocateViewProps) {
  const { t } = useTranslation();
  const session = sessions.find((entry) => entry.sessionNumber === selected) ?? sessions[0];

  if (!session) {
    return (
      <EmptyState
        icon={CircleParking}
        title={t('user.locate.notParkedTitle')}
        description={t('user.locate.notParkedHint')}
        action={
          availabilityLink ? (
            <Button asChild variant="outline">
              <Link to={PATHS.user.availability}>{t('user.home.seeAvailability')}</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      {sessions.length > 1 && (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t('user.locate.chooseVehicle')}
        >
          {sessions.map((entry) => (
            <button
              key={entry.sessionNumber}
              type="button"
              aria-pressed={entry.sessionNumber === session.sessionNumber}
              onClick={() => onSelect?.(entry.sessionNumber)}
              className={cn(
                'rounded-md border px-3 py-1.5 font-mono text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                entry.sessionNumber === session.sessionNumber
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-accent',
              )}
            >
              {entry.vehicleNumber}
            </button>
          ))}
        </div>
      )}

      <CurrentParkingPanel
        found={session.status === 'ACTIVE'}
        session={session}
        actions={
          <>
            {session.status === 'ACTIVE' && (
              <Button asChild variant="inverse">
                <a href="#locate-layout">
                  <MapIcon aria-hidden />
                  {t('user.actions.showOnMap')}
                </a>
              </Button>
            )}
            <BlockMapLink
              inverse
              size="default"
              coordinates={session.block.coordinates}
              label={t('user.actions.openBlockInMaps')}
            />
            {extraActions}
          </>
        }
      />

      {session.status === 'ACTIVE' && (
        <section
          id="locate-layout"
          aria-labelledby="locate-layout-title"
          className="scroll-mt-24 space-y-4"
        >
          <div className="space-y-1">
            <h2 id="locate-layout-title" className="text-lg font-semibold">
              {t('user.locate.layoutTitle', { slot: session.slotCode })}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('user.locate.mapsExplainer', {
                block: session.block.name,
                slot: session.slotCode,
                entry: formatHour(session.entryHour),
              })}
            </p>
          </div>
          {layout ? (
            <ParkingLayout layout={layout} focusSlot={session.slotCode} />
          ) : (
            <LoadingState />
          )}
        </section>
      )}
    </div>
  );
}

/** Locate my vehicle (Students and Campus Staff). */
export function LocatePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const sessions = useApiQuery(userApi.currentSessions);
  const layout = useApiQuery(userApi.layout, { refreshIntervalMs: 30_000 });

  return (
    <>
      <PageHeader title={t('user.locate.title')} description={t('user.locate.description')} />
      {sessions.status === 'loading' && <LoadingState />}
      {sessions.status === 'error' && (
        <ErrorState description={errorMessage(t, sessions.error)} onRetry={sessions.refetch} />
      )}
      {sessions.status === 'success' && (
        <LocateView
          sessions={sessions.data}
          layout={layout.status === 'success' ? layout.data : null}
          selected={params.get('session')}
          onSelect={(sessionNumber) => setParams({ session: sessionNumber }, { replace: true })}
          availabilityLink
        />
      )}
    </>
  );
}
