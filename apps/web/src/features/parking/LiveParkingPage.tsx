import type { ParkingSessionView } from '@cpvts/shared';
import { CircleAlert, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { areaPaths } from '@/app/paths';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { ParkingMap, type SelectedSlot } from '@/components/parking/ParkingMap';
import { SlotDetailsDialog } from '@/components/parking/SlotDetailsDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCurrentUser } from '@/features/auth/use-auth';
import { AlertsPanel } from '@/features/operations/AlertsPanel';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { formatHour } from '@/lib/format';

import { parkingApi } from './parking-api';
import { useVehicleSearch } from './use-vehicle-search';
import { VehicleSearchForm } from './VehicleSearchForm';

const REFRESH_MS = 30_000;

/** Live parking: map of every zone, highlight search and the parked-vehicle board. */
export function LiveParkingPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const paths = areaPaths(user.role);
  const [params, setParams] = useSearchParams();
  const map = useApiQuery(parkingApi.map, { refreshIntervalMs: REFRESH_MS });
  const active = useApiQuery(parkingApi.activeSessions, { refreshIntervalMs: REFRESH_MS });
  const { state: search, search: runSearch, clear } = useVehicleSearch();
  const [selected, setSelected] = useState<SelectedSlot | null>(null);

  const highlight =
    search.status === 'found' && search.result.session.status === 'ACTIVE'
      ? search.result.session.slotCode
      : params.get('slot');

  const clearHighlight = () => {
    clear();
    setParams({}, { replace: true });
  };

  const refresh = () => {
    map.reload();
    active.reload();
  };

  return (
    <>
      <PageHeader
        title={t('parking.live.title')}
        description={t('parking.live.description')}
        actions={
          <Button variant="outline" onClick={refresh}>
            <RefreshCw aria-hidden />
            {t('system.refresh')}
          </Button>
        }
      />
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-3">
            <VehicleSearchForm
              onSearch={(query) => void runSearch(query)}
              searching={search.status === 'searching'}
              submitLabel={t('parking.live.highlight')}
            />
            {search.status === 'error' && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden />
                <AlertDescription>{errorMessage(t, search.error)}</AlertDescription>
              </Alert>
            )}
            {highlight && (
              <div className="flex flex-wrap items-center gap-3 text-sm" aria-live="polite">
                <span>
                  {t('parking.live.highlighted', { slot: highlight })}
                  {search.status === 'found' && ` · ${search.result.session.vehicleNumber}`}
                </span>
                <Button variant="ghost" size="sm" onClick={clearHighlight}>
                  <X aria-hidden />
                  {t('parking.live.clearHighlight')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <AlertsPanel />

        {map.status === 'loading' && <LoadingState />}
        {map.status === 'error' && (
          <ErrorState description={errorMessage(t, map.error)} onRetry={map.refetch} />
        )}
        {map.status === 'success' && (
          <>
            <p className="text-sm text-muted-foreground">
              {t('public.availability.lastUpdated', { time: format.time(map.data.generatedAt) })}
            </p>
            <ParkingMap map={map.data} highlightSlot={highlight} onSelect={setSelected} />
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t('parking.live.activeVehicles')}</CardTitle>
          </CardHeader>
          <CardContent>
            {active.status === 'loading' && <LoadingState />}
            {active.status === 'error' && (
              <ErrorState description={errorMessage(t, active.error)} onRetry={active.refetch} />
            )}
            {active.status === 'success' &&
              (active.data.sessions.length === 0 ? (
                <EmptyState icon={CircleAlert} title={t('parking.live.noActive')} />
              ) : (
                <ActiveVehiclesTable
                  sessions={active.data.sessions}
                  onOpen={(session) => navigate(paths.session(session.sessionNumber))}
                />
              ))}
          </CardContent>
        </Card>
      </div>
      <SlotDetailsDialog selection={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function ActiveVehiclesTable({
  sessions,
  onOpen,
}: {
  sessions: ParkingSessionView[];
  onOpen: (session: ParkingSessionView) => void;
}) {
  const { t } = useTranslation();
  const format = useFormatters();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('parking.common.vehicleNumber')}</TableHead>
          <TableHead>{t('parking.common.vehicleType')}</TableHead>
          <TableHead>{t('parking.common.ownerCategory')}</TableHead>
          <TableHead>{t('parking.common.slot')}</TableHead>
          <TableHead>{t('parking.common.entry')}</TableHead>
          <TableHead>{t('parking.common.currentDuration')}</TableHead>
          <TableHead>{t('parking.common.estimatedFee')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow
            key={session.sessionNumber}
            className="cursor-pointer"
            onClick={() => onOpen(session)}
          >
            <TableCell>
              <button
                type="button"
                className="rounded-sm font-mono font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(session);
                }}
              >
                {session.vehicleNumber}
              </button>
            </TableCell>
            <TableCell>{t(`vehicleTypes.${session.vehicleType}`)}</TableCell>
            <TableCell>{t(`ownerCategories.${session.ownerCategory}`)}</TableCell>
            <TableCell className="font-semibold">{session.slotCode}</TableCell>
            <TableCell>{formatHour(session.entryHour)}</TableCell>
            <TableCell>
              {t('parking.common.hours', { count: session.currentDurationHours ?? 0 })}
            </TableCell>
            <TableCell>
              {session.estimatedFee ? format.paise(session.estimatedFee.totalPaise) : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
