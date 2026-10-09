import type {
  ParkNowConfirmation,
  ParkNowOffer,
  RegisteredVehicle,
} from '@cpvts/shared';
import { entryQrPayload } from '@cpvts/shared';
import {
  AlertTriangle,
  Bike,
  Car,
  CheckCircle2,
  Clock,
  Compass,
  Info,
  LoaderCircle,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PageHeader } from '@/components/layout/PageHeader';
import { QrCode } from '@/components/parking/QrCode';
import { VisualParkingLayout } from '@/components/parking/VisualParkingLayout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth, useCurrentUser } from '@/features/auth/use-auth';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';

import { portalApi } from './portal-api';

export function ParkNowPage() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const { refreshUser } = useAuth();

  const isVerified = user.parkingUser?.verificationStatus === 'VERIFIED';

  const vehiclesQuery = useApiQuery(portalApi.vehicles);
  const layoutQuery = useApiQuery(portalApi.layout);

  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [offer, setOffer] = useState<ParkNowOffer | null>(null);
  const [confirmed, setConfirmed] = useState<ParkNowConfirmation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  // If unverified, keep polling backend verification state
  useEffect(() => {
    if (!isVerified) {
      void refreshUser();
      const interval = setInterval(() => {
        void refreshUser();
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [isVerified, refreshUser]);

  // When verification becomes active, refetch vehicles and layout
  useEffect(() => {
    if (isVerified) {
      if (vehiclesQuery.status === 'error' || !vehiclesQuery.data) {
        vehiclesQuery.refetch();
      }
      if (layoutQuery.status === 'error' || !layoutQuery.data) {
        layoutQuery.refetch();
      }
    }
  }, [isVerified]); // eslint-disable-line react-hooks/exhaustive-deps

  const vehicles: RegisteredVehicle[] = useMemo(() => vehiclesQuery.data?.vehicles ?? [], [vehiclesQuery.data?.vehicles]);
  const defaultVehicleId = useMemo(() => {
    const unparked = vehicles.filter((v) => !v.activeSession);
    const candidate = unparked.find((v) => v.isPrimary) ?? unparked[0] ?? vehicles[0];
    return candidate?.id ?? '';
  }, [vehicles]);
  const activeVehicleId = selectedVehicleId || defaultVehicleId;

  // Check if there is an existing active offer on initial load
  useEffect(() => {
    if (!isVerified) return;
    portalApi
      .currentOffer()
      .then((res) => {
        if (res.offer) setOffer(res.offer);
      })
      .catch(() => {});
  }, [isVerified]);

  // Countdown timer for open offer
  useEffect(() => {
    if (!offer?.expiresAt) {
      return;
    }

    const updateRemaining = () => {
      const diff = Math.max(0, Math.floor((Date.parse(offer.expiresAt) - Date.now()) / 1000));
      setRemainingSeconds(diff);
      if (diff <= 0) {
        setOffer(null);
        setError('Your reserved parking space expired and was released. Please try again.');
      }
    };

    const timer = setInterval(updateRemaining, 1000);
    return () => {
      clearInterval(timer);
      setRemainingSeconds(null);
    };
  }, [offer]);

  const handleStartAllocation = async () => {
    if (!activeVehicleId) return;
    setError(null);
    setLoading(true);
    try {
      const result = await portalApi.startParkNow(activeVehicleId);
      setOffer(result);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!offer) return;
    setError(null);
    setLoading(true);
    try {
      const res = await portalApi.confirmParkNow(offer.offerId);
      setConfirmed(res);
      setOffer(null);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!offer) return;
    setLoading(true);
    try {
      await portalApi.cancelParkNow(offer.offerId);
      setOffer(null);
      setError(null);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setLoading(false);
    }
  };

  const selectedVehicle = vehicles.find((v) => v.id === activeVehicleId);
  const isVehicleAlreadyParked = Boolean(selectedVehicle?.activeSession);

  if (!isVerified) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Park Now"
          description="Automatic slot allocation and parking check-in"
        />
        <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
          <Clock className="size-5 text-amber-600 dark:text-amber-400" />
          <AlertTitle className="font-semibold">Verification Required</AlertTitle>
          <AlertDescription className="text-sm">
            Institutional identity verification is required before you can park.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link to="/portal/profile">Go to Profile</Link>
        </Button>
      </div>
    );
  }

  // Once session is confirmed
  if (confirmed) {
    const session = confirmed.session;
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <PageHeader
          title="Parking Confirmed"
          description="Your vehicle has been successfully checked in"
        />

        <div className="grid gap-6 md:grid-cols-[1fr_260px]">
          <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 via-card to-card p-6 shadow-md">
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-6" />
                <span className="text-sm font-bold uppercase tracking-wider">
                  Active Parking Session Created
                </span>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  YOUR ASSIGNED SPACE
                </p>
                <div className="flex items-baseline gap-3 mt-1">
                  <span className="font-mono text-5xl font-extrabold text-foreground tracking-tight">
                    {session.slotCode}
                  </span>
                  <span className="text-lg text-muted-foreground font-medium">
                    in {session.block.name} ({session.zone.name})
                  </span>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 pt-2">
                <div className="rounded-lg border bg-background/80 p-3">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                    Vehicle Number
                  </span>
                  <p className="font-mono text-base font-bold">{session.vehicleNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`vehicleTypes.${session.vehicleType}`)}
                  </p>
                </div>

                <div className="rounded-lg border bg-background/80 p-3">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                    Session Number
                  </span>
                  <p className="font-mono text-base font-bold">{session.sessionNumber}</p>
                  <p className="text-xs text-muted-foreground">Entry: Current Campus Hour</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-3">
                <Button asChild size="lg" className="gap-2">
                  <Link to="/portal/locate">
                    <Compass className="size-4" />
                    Locate on Parking Map
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/portal/my-parking">Go to My Parking</Link>
                </Button>
              </div>
            </div>
          </Card>

          {/* Session Entry QR */}
          {session.entryReference && (
            <Card className="flex flex-col items-center justify-center p-6 text-center shadow-md">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Session Entry QR
              </span>
              <div className="rounded-xl border bg-white p-2 shadow-inner">
                <QrCode
                  value={entryQrPayload(session.entryReference)}
                  label="Parking Session QR"
                  size={180}
                />
              </div>
              <p className="font-mono text-xs font-semibold mt-3 text-muted-foreground">
                {session.sessionNumber}
              </p>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Park Now"
        description="Instant slot allocation by CPVTS rule engine. No advance reservation needed."
        actions={
          <Badge
            variant="outline"
            className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 font-semibold gap-1.5 py-1 px-3 text-xs"
          >
            <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            ✓ Institutional identity verified
          </Badge>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-5" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Step 1: Vehicle Selection (when no offer is active) */}
      {!offer && (
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Car className="size-5 text-primary" />
              1. Select Your Vehicle
            </CardTitle>
            <CardDescription>
              Choose which of your registered vehicles you are parking right now.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {vehicles.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  You have not registered any vehicles yet.
                </p>
                <Button asChild>
                  <Link to="/portal/vehicles" className="gap-2">
                    <Plus className="size-4" />
                    Add a Vehicle
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {vehicles.map((v) => {
                  const Icon = v.vehicleType === 'TWO_WHEELER' ? Bike : Car;
                  const isSelected = activeVehicleId === v.id;
                  const isParked = Boolean(v.activeSession);

                  return (
                    <div
                      key={v.id}
                      onClick={() => !isParked && setSelectedVehicleId(v.id)}
                      className={`relative flex flex-col justify-between rounded-xl border-2 p-4 cursor-pointer transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/5 shadow-xs'
                          : isParked
                            ? 'border-border/50 bg-muted/30 opacity-60 cursor-not-allowed'
                            : 'border-border hover:border-primary/50 hover:bg-card'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="flex size-9 items-center justify-center rounded-lg bg-background shadow-xs">
                            <Icon className="size-5 text-primary" />
                          </div>
                          <div>
                            <span className="font-mono text-base font-bold block">
                              {v.vehicleNumber}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {v.label || t(`vehicleTypes.${v.vehicleType}`)}
                            </span>
                          </div>
                        </div>
                        {v.isPrimary && (
                          <Badge variant="secondary" className="text-[10px]">
                            Primary
                          </Badge>
                        )}
                      </div>

                      <div className="mt-4 pt-2 border-t flex items-center justify-between text-xs">
                        {isParked ? (
                          <span className="text-destructive font-semibold">
                            Already Parked ({v.activeSession?.slotCode})
                          </span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            Ready to Park
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {t(`vehicleTypes.${v.vehicleType}`)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {isVehicleAlreadyParked && (
              <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
                <Info className="size-4" />
                <AlertDescription className="text-xs">
                  This vehicle is already checked in to slot {selectedVehicle?.activeSession?.slotCode}.
                  You cannot check in the same vehicle twice.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button variant="ghost" size="sm" asChild className="text-xs text-muted-foreground">
                <Link to="/portal/vehicles">+ Register another vehicle</Link>
              </Button>

              <Button
                size="lg"
                onClick={handleStartAllocation}
                disabled={loading || !activeVehicleId || isVehicleAlreadyParked}
                className="gap-2"
              >
                {loading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Allocate Best Slot Now
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Show Allocated Slot + Reasoning + Visual Preview + Confirmation */}
      {offer && (
        <div className="space-y-6">
          <Card className="border-primary/40 bg-gradient-to-br from-primary/10 via-card to-card shadow-md">
            <CardHeader className="pb-3 border-b">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Badge variant="outline" className="border-primary text-primary font-semibold">
                    Allocated by CPVTS Engine
                  </Badge>
                  <CardTitle className="text-2xl font-extrabold tracking-tight mt-1">
                    YOUR PARKING SPACE
                  </CardTitle>
                </div>

                {remainingSeconds !== null && (
                  <div className="flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-1.5 border border-amber-500/30 text-amber-700 dark:text-amber-300">
                    <Clock className="size-4 animate-pulse" />
                    <span className="text-xs font-mono font-bold">
                      Hold expires in {Math.floor(remainingSeconds / 60)}:
                      {String(remainingSeconds % 60).padStart(2, '0')}
                    </span>
                  </div>
                )}
              </div>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              {/* Slot Announcement Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border bg-background/80 p-6 shadow-inner">
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    RESERVED SLOT
                  </p>
                  <span className="font-mono text-6xl font-black text-primary tracking-tight">
                    {offer.allocation.slotCode}
                  </span>
                  <p className="text-sm text-muted-foreground mt-1">
                    Located in <strong className="text-foreground">{offer.block.name}</strong>
                  </p>
                </div>

                <div className="text-left sm:text-right space-y-1">
                  <span className="text-xs text-muted-foreground">For Vehicle</span>
                  <p className="font-mono text-lg font-bold">{offer.vehicle.vehicleNumber}</p>
                  <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                    Billed as: {offer.ownerCategory}
                  </span>
                </div>
              </div>

              {/* WHY THIS SLOT? Breakdown */}
              <section
                aria-labelledby="why-slot-heading"
                className="rounded-xl border border-border/80 bg-muted/30 p-5 space-y-3"
              >
                <h3
                  id="why-slot-heading"
                  className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2"
                >
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                  WHY {offer.allocation.slotCode}?
                </h3>

                <ul className="grid sm:grid-cols-2 gap-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Correct zone for vehicle type</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Slot is currently available</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Slot is not blocked for maintenance</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Best valid allocation score</span>
                  </li>
                  <li className="flex items-center gap-2 sm:col-span-2">
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Final real-time availability verified before hold</span>
                  </li>
                </ul>

                <p className="text-xs text-muted-foreground/80 pt-1">
                  Compared {offer.allocation.candidatesConsidered} available candidate slots in this
                  zone. Deterministic allocation guarantees fair distribution.
                </p>
              </section>

              {/* Action Buttons */}
              <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={loading}
                  className="w-full sm:w-auto"
                >
                  <X className="size-4" />
                  Cancel Hold
                </Button>

                <Button
                  size="lg"
                  onClick={handleConfirm}
                  disabled={loading}
                  className="w-full sm:w-auto gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-8 shadow-md"
                >
                  {loading ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-5" />
                  )}
                  Confirm & Check In to {offer.allocation.slotCode}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Visual Parking Layout with the offered slot highlighted */}
          {layoutQuery.status === 'success' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold tracking-tight">
                  Parking Layout Preview — Allocated Slot Highlighted
                </h4>
                <Badge variant="outline" className="font-mono text-primary border-primary/30">
                  {offer.allocation.slotCode}
                </Badge>
              </div>
              <VisualParkingLayout
                blocks={layoutQuery.data.blocks}
                userSlotCodes={[offer.allocation.slotCode]}
                highlightSlot={offer.allocation.slotCode}
                informationalClick={false}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
