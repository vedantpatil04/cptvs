import {
  entryQrPayload,
  visitorReservationRequestSchema,
  type PublicOverviewResponse,
  type VehicleType,
  type VisitorReservationView,
} from '@cpvts/shared';
import {
  Bike,
  Car,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  MapPin,
  ParkingCircle,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { PATHS } from '@/app/paths';
import { HoldCountdown } from '@/components/parking/HoldCountdown';
import { QrCode } from '@/components/parking/QrCode';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/error-message';
import { describeFeeRule } from '@/features/public/fee-rule';
import { fetchPublicOverview } from '@/features/public/public-api';
import { cn } from '@/lib/utils';

import { visitorApi } from './visitor-api';
import { visitorReservationStore } from './visitor-reservation-store';
import { visitorSessionStore } from './visitor-session';

const TYPE_ICON = { TWO_WHEELER: Bike, FOUR_WHEELER: Car } as const;

/**
 * Visitor "Park My Vehicle": no account and no choices beyond the vehicle. The server picks the
 * block and slot and holds it; the visitor drives in, Security verifies the arrival and starts
 * the session. Everything on this page after the form is read from the server.
 */
export function VisitorParkPage() {
  const [token, setToken] = useState<string | null>(() => visitorReservationStore.get());
  const overview = useApiQuery(fetchPublicOverview, { refreshIntervalMs: 30_000 });

  return (
    <div className="bg-background">
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
        {token ? (
          <ReservationPass
            token={token}
            overview={overview.data}
            onClose={() => {
              visitorReservationStore.clear();
              setToken(null);
              overview.reload();
            }}
          />
        ) : (
          <ReserveForm
            overview={overview.data}
            onReserved={(accessToken, expiresAt) => {
              visitorReservationStore.set(accessToken, expiresAt);
              setToken(accessToken);
            }}
          />
        )}
      </main>
    </div>
  );
}

function ReserveForm({
  overview,
  onReserved,
}: {
  overview: PublicOverviewResponse | undefined;
  onReserved: (token: string, expiresAt: string) => void;
}) {
  const { t } = useTranslation();
  const format = useFormatters();
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('TWO_WHEELER');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const free = overview?.availability.find((entry) => entry.vehicleType === vehicleType);
  const full = free !== undefined && free.availableSlots === 0;
  const rule = overview?.feeSchedule?.rules.VISITOR[vehicleType];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const parsed = visitorReservationRequestSchema.safeParse({
      vehicleNumber,
      vehicleType,
      contactPhone: phone,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? 'form');
        next[field] ??= t(issue.message as never);
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitError(null);
    setBusy(true);
    try {
      const created = await visitorApi.reserve(parsed.data);
      onReserved(created.accessToken, created.accessExpiresAt);
    } catch (error) {
      setSubmitError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-3xl font-extrabold tracking-tight">{t('visitorPark.title')}</h1>
        <p className="text-muted-foreground">{t('visitorPark.description')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3" aria-label={t('visitorPark.availabilityTitle')}>
        {overview?.availability.map((entry) => {
          const Icon = TYPE_ICON[entry.vehicleType];
          return (
            <div key={entry.vehicleType} className="rounded-xl border bg-card p-3.5">
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Icon className="size-4" aria-hidden />
                {t(`vehicleTypes.${entry.vehicleType}`)}
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {format.number(entry.availableSlots)}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  {t('visitorPark.free')}
                </span>
              </p>
            </div>
          );
        }) ?? (
          <div
            className="col-span-2 h-[5.5rem] animate-pulse rounded-xl border bg-muted"
            aria-hidden
          />
        )}
      </div>

      <form onSubmit={(event) => void submit(event)} className="space-y-5" noValidate>
        {submitError !== null && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{errorMessage(t, submitError)}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-2">
          <Label htmlFor="visitor-plate">{t('visitorPark.vehicleNumber')}</Label>
          <Input
            id="visitor-plate"
            value={vehicleNumber}
            onChange={(event) => setVehicleNumber(event.target.value.toUpperCase())}
            placeholder="KA22AB1234"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.vehicleNumber)}
            className="h-12 font-mono text-lg tracking-wide"
          />
          {errors.vehicleNumber && (
            <p className="text-sm text-destructive">{errors.vehicleNumber}</p>
          )}
        </div>

        <div className="grid gap-2">
          <Label id="visitor-type-label">{t('visitorPark.vehicleType')}</Label>
          <ChoiceGroup
            name="visitor-vehicle-type"
            value={vehicleType}
            onChange={setVehicleType}
            aria-labelledby="visitor-type-label"
            options={[
              { value: 'TWO_WHEELER', label: t('vehicleTypes.TWO_WHEELER'), icon: Bike },
              { value: 'FOUR_WHEELER', label: t('vehicleTypes.FOUR_WHEELER'), icon: Car },
            ]}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="visitor-phone">{t('visitorPark.phone')}</Label>
          <Input
            id="visitor-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="98765 43210"
            autoComplete="tel"
            aria-invalid={Boolean(errors.contactPhone)}
            className="h-12 text-lg"
          />
          {errors.contactPhone ? (
            <p className="text-sm text-destructive">{errors.contactPhone}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('visitorPark.phoneHint')}</p>
          )}
        </div>

        {rule && (
          <p className="rounded-lg bg-muted px-3.5 py-2.5 text-sm">
            <span className="font-medium">{t('visitorPark.feeTitle')}: </span>
            {describeFeeRule(t, rule, format.paise)}
          </p>
        )}

        {full && (
          <Alert variant="warning">
            <CircleAlert aria-hidden />
            <AlertDescription>{t('visitorPark.full')}</AlertDescription>
          </Alert>
        )}

        <Button
          type="submit"
          variant="brand"
          size="lg"
          className="h-14 w-full text-base"
          disabled={busy || full}
        >
          {busy ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <ParkingCircle aria-hidden />
          )}
          {busy ? t('visitorPark.submitting') : t('parkMyVehicle.cta')}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {t('visitorPark.studentStaff')}{' '}
        <Link to={PATHS.login} className="font-medium text-foreground underline underline-offset-4">
          {t('visitorPark.signIn')}
        </Link>
      </p>
      <p className="text-center text-sm text-muted-foreground">
        {t('visitorPark.haveSlip')}{' '}
        <Link
          to={PATHS.visitor.root}
          className="font-medium text-foreground underline underline-offset-4"
        >
          {t('visitorPark.openSlip')}
        </Link>
      </p>
    </div>
  );
}

function ReservationPass({
  token,
  overview,
  onClose,
}: {
  token: string;
  overview: PublicOverviewResponse | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormatters();
  const navigate = useNavigate();
  const [cancelError, setCancelError] = useState<unknown>(null);
  const [cancelling, setCancelling] = useState(false);

  const fetcher = useCallback(() => visitorApi.reservation(token), [token]);
  const query = useApiQuery(fetcher, { refreshIntervalMs: 5_000 });

  // The pass is gone (expired token, unknown reservation): start over.
  const unauthorized =
    query.status === 'error' && query.error instanceof ApiError && query.error.status === 401;
  useEffect(() => {
    if (unauthorized) onClose();
  }, [unauthorized, onClose]);

  // Security started the session: hand over to the live session page.
  const started = query.status === 'success' ? query.data.session : null;
  useEffect(() => {
    if (started) {
      visitorSessionStore.set(started.accessToken);
      navigate(PATHS.visitor.parking, { replace: true });
    }
  }, [started, navigate]);

  if (query.status === 'loading' || started) {
    return (
      <div className="flex justify-center py-20" role="status" aria-live="polite">
        <LoaderCircle className="size-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  if (query.status === 'error') {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>{t('states.errorTitle')}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{errorMessage(t, query.error)}</p>
          <Button size="sm" variant="outline" onClick={query.refetch}>
            {t('common.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const reservation: VisitorReservationView = query.data.reservation;
  const held = reservation.status === 'HELD';
  const rule = overview?.feeSchedule?.rules.VISITOR[reservation.vehicleType];

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await visitorApi.cancelReservation(token);
      onClose();
    } catch (error) {
      setCancelError(error);
      setCancelling(false);
    }
  };

  if (!held) {
    return (
      <div className="space-y-5 text-center">
        <Alert variant="warning" className="text-left">
          <CircleAlert aria-hidden />
          <AlertTitle>
            {reservation.status === 'CANCELLED'
              ? t('visitorPark.cancelled')
              : t('visitorPark.expired')}
          </AlertTitle>
          <AlertDescription>{t('visitorPark.expiredBody')}</AlertDescription>
        </Alert>
        <Button variant="brand" size="lg" className="h-12 w-full" onClick={onClose}>
          {t('visitorPark.reserveAgain')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-brand">
          <CircleCheck className="size-4" aria-hidden />
          {t('visitorPark.heldTitle')}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">{reservation.vehicleNumber}</h1>
        <p className="text-muted-foreground">{t('visitorPark.heldBody')}</p>
      </div>

      <HoldCountdown
        expiresAt={reservation.expiresAt}
        totalSeconds={reservation.holdSeconds}
        label={t('visitorPark.expiresIn')}
        onExpire={() => query.reload()}
      />

      <div className="grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('parking.common.block')}
            </p>
            <p className="flex items-center gap-1.5 text-xl font-bold">
              <MapPin className="size-5 text-brand" aria-hidden />
              {reservation.block.name}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('parking.common.slot')}
            </p>
            <p className="font-mono text-6xl leading-none font-extrabold tracking-tight">
              {reservation.slotCode}
            </p>
          </div>
        </div>
        {reservation.qrReference && (
          <div className="mx-auto space-y-2 text-center">
            <QrCode
              value={entryQrPayload(reservation.qrReference)}
              label={t('visitorPark.qrLabel')}
              size={176}
              className="border"
            />
            <p className="text-xs text-muted-foreground">{t('visitorPark.qrHint')}</p>
          </div>
        )}
      </div>

      {rule && (
        <p className="rounded-lg bg-muted px-3.5 py-2.5 text-sm">
          <span className="font-medium">{t('visitorPark.feeTitle')}: </span>
          {describeFeeRule(t, rule, format.paise)}
        </p>
      )}

      <section aria-labelledby="visitor-steps">
        <h2 id="visitor-steps" className="mb-2 text-sm font-semibold">
          {t('visitorPark.stepsTitle')}
        </h2>
        <ol className="space-y-2 text-sm">
          {(['step1', 'step2', 'step3', 'step4'] as const).map((step, index) => (
            <li key={step} className="flex gap-3">
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                  index === 0 ? 'bg-brand text-brand-foreground' : 'bg-secondary',
                )}
              >
                {index + 1}
              </span>
              <span className="pt-0.5">
                {t(`visitorPark.${step}`, {
                  block: reservation.block.name,
                  slot: reservation.slotCode,
                })}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {cancelError !== null && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(t, cancelError)}</AlertDescription>
        </Alert>
      )}
      <Button
        variant="outline"
        size="lg"
        className="h-12 w-full"
        onClick={() => void cancel()}
        disabled={cancelling}
      >
        {cancelling ? <LoaderCircle className="animate-spin" aria-hidden /> : <X aria-hidden />}
        {t('visitorPark.cancel')}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t('visitorPark.saveNote')}</p>
    </div>
  );
}
