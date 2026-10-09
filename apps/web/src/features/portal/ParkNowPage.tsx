import type { ParkNowConfirmation, ParkNowOffer, RegisteredVehicle } from '@cpvts/shared';
import {
  Bike,
  Car,
  CircleAlert,
  CircleCheck,
  Clock,
  Compass,
  LoaderCircle,
  MapPin,
  ParkingCircle,
  Plus,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PageHeader } from '@/components/layout/PageHeader';
import { ExitPass } from '@/components/parking/ExitPass';
import { HoldCountdown } from '@/components/parking/HoldCountdown';
import { SessionTimer } from '@/components/parking/SessionTimer';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth, useCurrentUser } from '@/features/auth/use-auth';
import { describeFeeRule } from '@/features/public/fee-rule';
import { fetchPublicOverview } from '@/features/public/public-api';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { serverNow } from '@/lib/server-clock';
import { cn } from '@/lib/utils';

import { portalApi } from './portal-api';

const TYPE_ICON = { TWO_WHEELER: Bike, FOUR_WHEELER: Car } as const;

/** Whole seconds a freshly received hold lasts, for the countdown bar. */
const holdLength = (expiresAt: string): number =>
  Math.max(1, Math.round((Date.parse(expiresAt) - serverNow()) / 1000));

/**
 * "Park My Vehicle" for verified Students and Campus Staff. There is nothing to choose except the
 * vehicle (and only when more than one is registered): the server picks the block and the slot,
 * holds it for a short time and the user confirms. The hold is released on cancel or expiry.
 */
export function ParkNowPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const { user } = useCurrentUser();
  const { refreshUser } = useAuth();
  const isVerified = user.parkingUser?.verificationStatus === 'VERIFIED';

  const vehiclesQuery = useApiQuery(portalApi.vehicles);
  const overview = useApiQuery(fetchPublicOverview);

  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [offer, setOffer] = useState<ParkNowOffer | null>(null);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const [confirmed, setConfirmed] = useState<ParkNowConfirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While verification is pending, keep checking so the page unlocks by itself.
  useEffect(() => {
    if (isVerified) return;
    void refreshUser();
    const interval = setInterval(() => void refreshUser(), 4000);
    return () => clearInterval(interval);
  }, [isVerified, refreshUser]);

  // Resume an open hold after a reload.
  useEffect(() => {
    if (!isVerified) return;
    portalApi
      .currentOffer()
      .then((res) => {
        if (res.offer) {
          setOffer(res.offer);
          setHoldSeconds(holdLength(res.offer.expiresAt));
        }
      })
      .catch(() => undefined);
  }, [isVerified]);

  const vehicles: RegisteredVehicle[] = useMemo(
    () => vehiclesQuery.data?.vehicles ?? [],
    [vehiclesQuery.data?.vehicles],
  );
  const parkable = vehicles.filter((vehicle) => !vehicle.activeSession);
  const defaultId = (parkable.find((v) => v.isPrimary) ?? parkable[0])?.id ?? '';
  const vehicleId = parkable.some((v) => v.id === selectedVehicleId)
    ? selectedVehicleId
    : defaultId;
  const vehicle = vehicles.find((v) => v.id === vehicleId);

  const start = async () => {
    if (!vehicleId || busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await portalApi.startParkNow(vehicleId);
      setOffer(result);
      setHoldSeconds(holdLength(result.expiresAt));
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!offer || busy) return;
    setError(null);
    setBusy(true);
    try {
      setConfirmed(await portalApi.confirmParkNow(offer.offerId));
      setOffer(null);
    } catch (caught) {
      setError(errorMessage(t, caught));
      setOffer(null);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!offer || busy) return;
    setBusy(true);
    try {
      await portalApi.cancelParkNow(offer.offerId);
      setOffer(null);
      setError(null);
    } catch (caught) {
      setError(errorMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  if (!isVerified) {
    return (
      <div className="max-w-2xl space-y-5">
        <PageHeader title={t('parkMyVehicle.title')} description={t('parkMyVehicle.description')} />
        <Alert variant="warning">
          <Clock aria-hidden />
          <AlertTitle>{t('parkMyVehicle.verifyTitle')}</AlertTitle>
          <AlertDescription>{t('parkMyVehicle.verifyBody')}</AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link to="/portal/profile">{t('parkMyVehicle.goProfile')}</Link>
        </Button>
      </div>
    );
  }

  if (confirmed) {
    const session = confirmed.session;
    return (
      <div className="max-w-3xl space-y-5">
        <PageHeader
          title={t('parkMyVehicle.confirmedTitle')}
          description={t('parkMyVehicle.confirmedNext')}
        />
        <div className="grid gap-5 md:grid-cols-[1fr_auto]">
          <div className="space-y-4 rounded-2xl border bg-card p-5">
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t('parkMyVehicle.yourSpace')}
              </p>
              <p className="font-mono text-6xl leading-none font-extrabold tracking-tight">
                {session.slotCode}
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 text-muted-foreground">
                <MapPin className="size-4 text-brand" aria-hidden />
                {session.block.name} · {session.zone.name}
              </p>
            </div>
            <p className="font-mono text-lg font-bold">
              {session.vehicleNumber}
              <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
                {t(`vehicleTypes.${session.vehicleType}`)}
              </span>
            </p>
            <p className="font-mono text-xs text-muted-foreground">{session.sessionNumber}</p>
            <SessionTimer session={session} />
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="brand" size="lg" className="h-12">
                <Link to="/portal/locate">
                  <Compass aria-hidden />
                  {t('parkMyVehicle.locate')}
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-12">
                <Link to="/portal/my-parking">{t('parkMyVehicle.myParking')}</Link>
              </Button>
            </div>
          </div>
          {session.entryReference && (
            <div className="rounded-2xl border bg-card p-5">
              <ExitPass
                entryReference={session.entryReference}
                issueCode={() => portalApi.issueExitCode(session.sessionNumber)}
                qrSize={170}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  const rule =
    offer && overview.status === 'success'
      ? overview.data.feeSchedule?.rules[offer.ownerCategory][offer.vehicle.vehicleType]
      : undefined;

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title={t('parkMyVehicle.title')} description={t('parkMyVehicle.description')} />

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!offer && (
        <div className="space-y-5 rounded-2xl border bg-card p-5">
          {vehiclesQuery.status === 'loading' && (
            <div className="h-24 animate-pulse rounded-xl bg-muted" aria-hidden />
          )}

          {vehiclesQuery.status === 'success' && vehicles.length === 0 && (
            <div className="space-y-3 text-center">
              <p className="text-muted-foreground">{t('parkMyVehicle.noVehicles')}</p>
              <Button asChild size="lg" className="h-12">
                <Link to="/portal/vehicles">
                  <Plus aria-hidden />
                  {t('parkMyVehicle.addVehicle')}
                </Link>
              </Button>
            </div>
          )}

          {vehicles.length > 0 && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold">
                {vehicles.length > 1
                  ? t('parkMyVehicle.selectVehicle')
                  : t('parkMyVehicle.oneVehicle')}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {vehicles.map((item) => {
                  const Icon = TYPE_ICON[item.vehicleType];
                  const parked = Boolean(item.activeSession);
                  const selected = item.id === vehicleId;
                  return (
                    <label
                      key={item.id}
                      className={cn(
                        'flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border-2 p-3.5 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                        selected ? 'border-brand bg-brand/5' : 'hover:bg-accent',
                        parked && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <input
                        type="radio"
                        name="vehicle"
                        className="sr-only"
                        checked={selected}
                        disabled={parked}
                        onChange={() => setSelectedVehicleId(item.id)}
                      />
                      <span className="grid size-10 place-items-center rounded-lg bg-secondary">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-lg font-bold">
                          {item.vehicleNumber}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {parked
                            ? t('parkMyVehicle.parkedIn', { slot: item.activeSession?.slotCode })
                            : (item.label ?? t(`vehicleTypes.${item.vehicleType}`))}
                        </span>
                      </span>
                      {selected && <CircleCheck className="size-5 text-brand" aria-hidden />}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {vehicles.length > 0 && parkable.length === 0 && (
            <Alert variant="info">
              <AlertDescription>{t('parkMyVehicle.allParked')}</AlertDescription>
            </Alert>
          )}

          {vehicle && !vehicle.activeSession && (
            <Button
              variant="brand"
              size="lg"
              className="h-14 w-full text-base"
              disabled={busy}
              onClick={() => void start()}
            >
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <ParkingCircle aria-hidden />
              )}
              {busy ? t('parkMyVehicle.finding') : t('parkMyVehicle.cta')}
            </Button>
          )}
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/portal/vehicles" className="underline underline-offset-4">
              {t('parkMyVehicle.registerAnother')}
            </Link>
          </p>
        </div>
      )}

      {offer && (
        <div className="space-y-4 rounded-2xl border-2 border-brand/40 bg-card p-5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-brand">
            <CircleCheck className="size-4" aria-hidden />
            {t('parkMyVehicle.holdTitle')}
          </p>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t('parking.common.slot')}
              </p>
              <p className="font-mono text-7xl leading-none font-extrabold tracking-tight">
                {offer.allocation.slotCode}
              </p>
            </div>
            <div className="text-right">
              <p className="flex items-center justify-end gap-1.5 text-lg font-bold">
                <MapPin className="size-5 text-brand" aria-hidden />
                {offer.block.name}
              </p>
              <p className="text-sm text-muted-foreground">{offer.allocation.zoneName}</p>
              <p className="mt-1 font-mono text-lg font-bold">{offer.vehicle.vehicleNumber}</p>
            </div>
          </div>

          <HoldCountdown
            expiresAt={offer.expiresAt}
            totalSeconds={holdSeconds}
            onExpire={() => {
              setOffer(null);
              setError(t('parkMyVehicle.holdExpired'));
            }}
          />

          <p className="rounded-lg bg-muted px-3.5 py-2.5 text-sm">
            <span className="font-medium">
              {t('parkMyVehicle.billedAs', {
                category: t(`ownerCategories.${offer.ownerCategory}`),
              })}
              {rule ? ': ' : ''}
            </span>
            {rule ? describeFeeRule(t, rule, format.paise) : null}
          </p>
          <p className="text-sm text-muted-foreground">{t('parkMyVehicle.holdHint')}</p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              size="lg"
              className="h-12"
              disabled={busy}
              onClick={() => void cancel()}
            >
              <X aria-hidden />
              {t('parkMyVehicle.cancelHold')}
            </Button>
            <Button
              variant="brand"
              size="lg"
              className="h-12 flex-1"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <CircleCheck aria-hidden />
              )}
              {t('parkMyVehicle.confirm', { slot: offer.allocation.slotCode })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
