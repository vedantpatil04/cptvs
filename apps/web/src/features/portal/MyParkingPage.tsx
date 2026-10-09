import type { ParkingSessionView } from '@cpvts/shared';
import {
  Bike,
  Car,
  Compass,
  CreditCard,
  History,
  MapPin,
  ParkingCircle,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { BlockMapLink } from '@/components/parking/BlockMapLink';
import { ExitPass } from '@/components/parking/ExitPass';
import { SessionTimer } from '@/components/parking/SessionTimer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SessionTimeline } from '@/features/parking/SessionTimeline';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';

import { portalApi } from './portal-api';

export function MyParkingPage() {
  const { t } = useTranslation();

  const sessionsQuery = useApiQuery(portalApi.activeSessions, { refreshIntervalMs: 20_000 });
  const [timelineSession, setTimelineSession] = useState<ParkingSessionView | null>(null);

  const sessions = sessionsQuery.data?.sessions ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Parking"
        description="Active parking sessions registered to your vehicles"
        actions={
          <Button variant="outline" size="sm" onClick={sessionsQuery.reload}>
            <RefreshCw className="size-4" aria-hidden />
            Refresh
          </Button>
        }
      />

      {sessionsQuery.status === 'loading' && <LoadingState />}
      {sessionsQuery.status === 'error' && (
        <ErrorState
          description={errorMessage(t, sessionsQuery.error)}
          onRetry={sessionsQuery.refetch}
        />
      )}

      {sessionsQuery.status === 'success' && (
        <>
          {sessions.length === 0 ? (
            <Card className="p-12 text-center border-dashed">
              <div className="max-w-md mx-auto space-y-4">
                <div className="flex size-14 items-center justify-center rounded-full bg-muted mx-auto text-muted-foreground">
                  <ParkingCircle className="size-8" />
                </div>
                <h3 className="text-xl font-bold tracking-tight">No Active Parking Sessions</h3>
                <p className="text-sm text-muted-foreground">
                  None of your registered vehicles are currently parked on campus. Use Park Now to
                  find an available parking slot instantly.
                </p>
                <Button asChild size="lg" className="gap-2">
                  <Link to="/portal/park-now">
                    <ParkingCircle className="size-4" />
                    Park Now
                  </Link>
                </Button>
              </div>
            </Card>
          ) : (
            <div className="grid gap-6">
              {sessions.map((session) => {
                const Icon = session.vehicleType === 'TWO_WHEELER' ? Bike : Car;
                return (
                  <Card
                    key={session.sessionNumber}
                    className="border-primary/30 bg-gradient-to-br from-card via-card to-primary/5 shadow-md overflow-hidden"
                  >
                    <div className="p-6">
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                        {/* Main Session Information */}
                        <div className="space-y-4 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex size-2 rounded-full bg-emerald-500 animate-ping" />
                            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white font-semibold">
                              ACTIVE SESSION
                            </Badge>
                            <span className="font-mono text-xs text-muted-foreground">
                              {session.sessionNumber}
                            </span>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {session.ownerCategory}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-baseline gap-4">
                            <div className="flex items-center gap-2.5">
                              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Icon className="size-5" />
                              </div>
                              <span className="font-mono text-3xl font-extrabold tracking-tight">
                                {session.vehicleNumber}
                              </span>
                            </div>

                            <div className="text-sm text-muted-foreground">
                              {t(`vehicleTypes.${session.vehicleType}`)}
                            </div>
                          </div>

                          {/* Location & Slot Callout */}
                          <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-background/80 p-4">
                            <div>
                              <span className="text-[10px] uppercase font-bold text-muted-foreground">
                                Parking Block
                              </span>
                              <p className="font-semibold text-base flex items-center gap-1.5 mt-0.5">
                                <MapPin className="size-4 text-primary" />
                                {session.block.name}
                              </p>
                            </div>

                            <div className="h-8 w-px bg-border" />

                            <div>
                              <span className="text-[10px] uppercase font-bold text-muted-foreground">
                                Exact Slot
                              </span>
                              <p className="font-mono font-black text-2xl text-primary mt-0.5">
                                {session.slotCode}
                              </p>
                            </div>

                            <div className="h-8 w-px bg-border" />

                            <div>
                              <span className="text-[10px] uppercase font-bold text-muted-foreground">
                                Zone
                              </span>
                              <p className="text-sm font-medium mt-0.5">{session.zone.name}</p>
                            </div>

                            {session.block.coordinates && (
                              <div className="ml-auto">
                                <BlockMapLink coordinates={session.block.coordinates} />
                              </div>
                            )}
                          </div>

                          <SessionTimer session={session} onStale={sessionsQuery.reload} />

                          {/* Action Buttons */}
                          <div className="flex flex-wrap items-center gap-2 pt-2">
                            <Button asChild size="default" className="gap-2">
                              <Link
                                to={`/portal/locate?session=${encodeURIComponent(session.sessionNumber)}`}
                              >
                                <Compass className="size-4" />
                                Locate My Vehicle
                              </Link>
                            </Button>

                            <Button asChild variant="outline" size="default" className="gap-2">
                              <Link
                                to={`/portal/parking?slot=${encodeURIComponent(session.slotCode)}`}
                              >
                                <MapPin className="size-4" />
                                Show on Parking Map
                              </Link>
                            </Button>

                            <Button
                              variant="outline"
                              size="default"
                              onClick={() => setTimelineSession(session)}
                              className="gap-2"
                            >
                              <History className="size-4" />
                              View Timeline
                            </Button>

                            <Button
                              asChild
                              size="default"
                              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white ml-auto"
                            >
                              <Link
                                to={`/portal/checkout?session=${encodeURIComponent(session.sessionNumber)}`}
                              >
                                <CreditCard className="size-4" />
                                Check Out
                              </Link>
                            </Button>
                          </div>
                        </div>

                        <ExitPass
                          entryReference={session.entryReference}
                          issueCode={() => portalApi.issueExitCode(session.sessionNumber)}
                          qrSize={150}
                          className="w-full shrink-0 rounded-xl border bg-card p-4 lg:w-56"
                        />
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Timeline Modal */}
      <Dialog
        open={timelineSession !== null}
        onOpenChange={(open) => !open && setTimelineSession(null)}
      >
        <DialogContent className="max-w-2xl" closeLabel={t('common.close')}>
          {timelineSession && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Parking Session Timeline · #{timelineSession.sessionNumber}
                </DialogTitle>
                <DialogDescription>
                  Audit log history for vehicle {timelineSession.vehicleNumber} in slot{' '}
                  {timelineSession.slotCode}
                </DialogDescription>
              </DialogHeader>

              <div className="py-2">
                <SessionTimeline sessionNumber={timelineSession.sessionNumber} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
