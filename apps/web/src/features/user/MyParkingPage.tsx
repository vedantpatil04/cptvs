import type { ParkingSessionView } from '@cpvts/shared';
import { CircleParking, Map as MapIcon, MapPinned, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS, userPaths } from '@/app/paths';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { BlockMapLink } from '@/components/parking/BlockMapLink';
import { FeeBreakdownView } from '@/components/parking/FeeBreakdownView';
import { PlateBadge } from '@/components/parking/PlateBadge';
import { AvailabilityStrip } from '@/components/user/AvailabilityStrip';
import { CurrentParkingPanel } from '@/components/user/CurrentParkingPanel';
import { Button } from '@/components/ui/button';
import { DescriptionItem, DescriptionList } from '@/components/ui/description-list';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { formatHour } from '@/lib/format';

import { userApi } from './user-api';

/** Every fact of a session for the signed-in user, from the server's records. */
export function SessionFacts({ session }: { session: ParkingSessionView }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const active = session.status === 'ACTIVE';
  const duration = active ? session.currentDurationHours : session.durationHours;
  const fee = active ? session.estimatedFee : session.fee;

  return (
    <DescriptionList>
      <DescriptionItem label={t('parking.common.vehicleNumber')}>
        <PlateBadge value={session.vehicleNumber} className="text-sm" />
      </DescriptionItem>
      <DescriptionItem label={t('parking.common.vehicleType')}>
        {t(`vehicleTypes.${session.vehicleType}`)}
      </DescriptionItem>
      <DescriptionItem label={t('parking.common.ownerCategory')}>
        {t(`ownerCategories.${session.ownerCategory}`)}
      </DescriptionItem>
      <DescriptionItem label={t('parking.common.block')}>{session.block.name}</DescriptionItem>
      <DescriptionItem label={t('parking.common.slot')}>
        <span className="text-lg font-bold" translate="no">
          {session.slotCode}
        </span>
      </DescriptionItem>
      <DescriptionItem label={t('parking.common.entry')}>
        {format.date(session.entryAt)} · {formatHour(session.entryHour)}
      </DescriptionItem>
      {!active && session.exitHour !== null && (
        <DescriptionItem label={t('parking.common.exit')}>
          {session.exitAt ? `${format.date(session.exitAt)} · ` : ''}
          {formatHour(session.exitHour)}
        </DescriptionItem>
      )}
      {duration !== null && (
        <DescriptionItem
          label={active ? t('parking.common.currentDuration') : t('parking.common.duration')}
        >
          {t('parking.common.hours', { count: duration })}
        </DescriptionItem>
      )}
      {fee && (
        <DescriptionItem label={active ? t('parking.common.estimatedFee') : t('history.fee')}>
          <FeeBreakdownView fee={fee} className="max-w-xs" />
          {active && (
            <span className="mt-2 block text-xs font-normal text-muted-foreground">
              {t('parking.common.estimatedFeeHint')}
            </span>
          )}
        </DescriptionItem>
      )}
      <DescriptionItem label={t('parking.common.sessionNumber')}>
        <span className="font-mono" translate="no">
          {session.sessionNumber}
        </span>
      </DescriptionItem>
      <DescriptionItem label={t('parking.common.status')}>
        <StatusBadge tone={active ? 'info' : 'neutral'} dot={active}>
          {t(`parking.sessionStatus.${session.status}`)}
        </StatusBadge>
      </DescriptionItem>
    </DescriptionList>
  );
}

/** The dedicated current-session page. */
export function MyParkingPage() {
  const { t } = useTranslation();
  const overview = useApiQuery(userApi.overview, { refreshIntervalMs: 30_000 });
  const format = useFormatters();

  return (
    <>
      <PageHeader title={t('user.myParking.title')} description={t('user.myParking.description')} />
      {overview.status === 'loading' && <LoadingState />}
      {overview.status === 'error' && (
        <ErrorState description={errorMessage(t, overview.error)} onRetry={overview.refetch} />
      )}
      {overview.status === 'success' &&
        (overview.data.activeSessions.length === 0 ? (
          <div className="space-y-8">
            <EmptyState
              icon={CircleParking}
              title={t('user.home.notParkedTitle')}
              description={t('user.myParking.emptyHint')}
            />
            <section className="space-y-3" aria-labelledby="mp-availability">
              <h2
                id="mp-availability"
                className="text-xs font-semibold tracking-widest text-muted-foreground uppercase"
              >
                {t('user.home.liveAvailability')}
              </h2>
              <AvailabilityStrip
                figures={overview.data.availability.map((entry) => ({
                  vehicleType: entry.vehicleType,
                  available: entry.availableSlots,
                  total: entry.totalSlots,
                }))}
              />
              <p className="text-xs text-muted-foreground">
                {t('public.availability.lastUpdated', {
                  time: format.time(overview.data.generatedAt),
                })}
              </p>
              <Button asChild variant="outline">
                <Link to={PATHS.user.availability}>
                  <MapIcon aria-hidden />
                  {t('user.home.viewLayout')}
                </Link>
              </Button>
            </section>
          </div>
        ) : (
          <div className="space-y-10">
            {overview.data.activeSessions.map((session) => (
              <div key={session.sessionNumber} className="space-y-6">
                <CurrentParkingPanel session={session} />
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <Link to={userPaths.locate(session.sessionNumber)}>
                      <MapPinned aria-hidden />
                      {t('user.actions.locate')}
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to={userPaths.availability(session.slotCode)}>
                      <MapIcon aria-hidden />
                      {t('user.actions.showOnMap')}
                    </Link>
                  </Button>
                  <BlockMapLink coordinates={session.block.coordinates} size="default" />
                  <Button asChild variant="outline">
                    <Link to={userPaths.session(session.sessionNumber)}>
                      <ScrollText aria-hidden />
                      {t('user.actions.viewSession')}
                    </Link>
                  </Button>
                </div>
                <SessionFacts session={session} />
              </div>
            ))}
          </div>
        ))}
    </>
  );
}
