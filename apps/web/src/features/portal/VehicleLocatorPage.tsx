import type { ParkingSessionView } from '@cpvts/shared';
import {
  Compass,
  CreditCard,
  ExternalLink,
  MapPin,
  ParkingCircle,
  RefreshCw,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { SessionTimer } from '@/components/parking/SessionTimer';
import { VisualParkingLayout } from '@/components/parking/VisualParkingLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';

import { portalApi } from './portal-api';

export function VehicleLocatorPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const [params] = useSearchParams();

  const sessionsQuery = useApiQuery(portalApi.activeSessions, { refreshIntervalMs: 20_000 });
  const layoutQuery = useApiQuery(portalApi.layout, { refreshIntervalMs: 20_000 });

  const activeSessions: ParkingSessionView[] = useMemo(
    () => sessionsQuery.data?.sessions ?? [],
    [sessionsQuery.data?.sessions],
  );
  const paramSessionNumber = params.get('session');
  const [selectedSessionNumber, setSelectedSessionNumber] = useState<string | null>(null);

  const activeSession: ParkingSessionView | null = useMemo(() => {
    if (activeSessions.length === 0) return null;
    const target = selectedSessionNumber || paramSessionNumber;
    if (target) {
      const found = activeSessions.find((s: ParkingSessionView) => s.sessionNumber === target);
      if (found) return found;
    }
    return activeSessions[0] ?? null;
  }, [activeSessions, selectedSessionNumber, paramSessionNumber]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Locator"
        description="Signature CPVTS feature: precise stall mapping and block-level navigation"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              sessionsQuery.reload();
              layoutQuery.reload();
            }}
          >
            <RefreshCw className="size-4" aria-hidden />
            Refresh
          </Button>
        }
      />

      {(sessionsQuery.status === 'loading' || layoutQuery.status === 'loading') && <LoadingState />}
      {(sessionsQuery.status === 'error' || layoutQuery.status === 'error') && (
        <ErrorState
          description={errorMessage(t, sessionsQuery.error || layoutQuery.error)}
          onRetry={() => {
            sessionsQuery.refetch();
            layoutQuery.refetch();
          }}
        />
      )}

      {sessionsQuery.status === 'success' && activeSessions.length === 0 && (
        <Card className="p-12 text-center border-dashed">
          <div className="max-w-md mx-auto space-y-4">
            <div className="flex size-14 items-center justify-center rounded-full bg-muted mx-auto text-muted-foreground">
              <Compass className="size-8" />
            </div>
            <h3 className="text-xl font-bold tracking-tight">No Vehicle Currently Parked</h3>
            <p className="text-sm text-muted-foreground">
              You do not have any active parking sessions. Once you park your vehicle with Park My Vehicle,
              its live location will be mapped here.
            </p>
            <Button asChild className="gap-2">
              <Link to="/portal/park-now">
                <ParkingCircle className="size-4" />
                Park a Vehicle Now
              </Link>
            </Button>
          </div>
        </Card>
      )}

      {activeSession && (
        <div className="space-y-6">
          {/* VEHICLE FOUND Signature Card */}
          <Card className="border-primary/40 bg-gradient-to-br from-primary/10 via-card to-card p-6 shadow-md">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div className="flex items-center gap-2 text-primary">
                  <div className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground animate-pulse">
                    <MapPin className="size-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider block">
                      Signature Vehicle Locator
                    </span>
                    <h2 className="text-2xl font-black tracking-tight text-foreground">
                      VEHICLE FOUND
                    </h2>
                  </div>
                </div>

                {activeSessions.length > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Vehicle:</span>
                    <select
                      value={activeSession.sessionNumber}
                      onChange={(e) => {
                        setSelectedSessionNumber(e.target.value);
                      }}
                      className="rounded-md border bg-background px-3 py-1 text-xs font-mono font-bold"
                    >
                      {activeSessions.map((s: ParkingSessionView) => (
                        <option key={s.sessionNumber} value={s.sessionNumber}>
                          {s.vehicleNumber} ({s.slotCode})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Vehicle & Exact Slot Details Grid */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-xl border bg-background/80 p-4">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase">
                    Vehicle Number
                  </span>
                  <p className="font-mono text-2xl font-black mt-1">
                    {activeSession.vehicleNumber}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`vehicleTypes.${activeSession.vehicleType}`)} · {activeSession.ownerCategory}
                  </p>
                </div>

                <div className="rounded-xl border bg-background/80 p-4 border-primary/30">
                  <span className="text-[10px] font-bold text-primary uppercase">
                    Exact Slot ID
                  </span>
                  <p className="font-mono text-3xl font-black text-primary mt-0.5">
                    {activeSession.slotCode}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Zone: {activeSession.zone.name}
                  </p>
                </div>

                <div className="rounded-xl border bg-background/80 p-4">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase">
                    Parking Block
                  </span>
                  <p className="text-xl font-bold mt-1 flex items-center gap-1.5">
                    <MapPin className="size-4 text-primary" />
                    {activeSession.block.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Entry: {format.time(activeSession.entryAt)}
                  </p>
                </div>

                </div>

              <SessionTimer session={activeSession} onStale={sessionsQuery.reload} />

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                {activeSession.block.coordinates ? (
                  <Button asChild size="default" className="gap-2">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${activeSession.block.coordinates.latitude},${activeSession.block.coordinates.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="size-4" />
                      Open Parking Block in Google Maps
                    </a>
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Block-level GPS coordinates pending
                  </span>
                )}

                <Button asChild variant="outline" size="default">
                  <Link to={`/portal/checkout?session=${encodeURIComponent(activeSession.sessionNumber)}`}>
                    <CreditCard className="size-4" />
                    Check Out This Vehicle
                  </Link>
                </Button>
              </div>
            </div>
          </Card>

          {/* Parking Layout with User Slot Highlighted */}
          {layoutQuery.status === 'success' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold tracking-tight">
                    Campus Parking Layout — Your Space Marked
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    CPVTS visual layout indicates the exact stall. Google Maps navigates to the
                    parking block gate.
                  </p>
                </div>
                <Badge className="font-mono text-sm bg-primary text-primary-foreground font-bold px-3 py-1">
                  Stall {activeSession.slotCode}
                </Badge>
              </div>

              <VisualParkingLayout
                blocks={layoutQuery.data.blocks}
                userSlotCodes={[activeSession.slotCode]}
                highlightSlot={activeSession.slotCode}
                informationalClick={true}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
