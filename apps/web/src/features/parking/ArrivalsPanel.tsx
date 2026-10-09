import type { ArrivalView, ParkingSessionView } from '@cpvts/shared';
import {
  Camera,
  CircleAlert,
  CircleCheck,
  KeyRound,
  LoaderCircle,
  Phone,
  Search,
  UserRoundCheck,
} from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { areaPaths } from '@/app/paths';
import { HoldCountdown } from '@/components/parking/HoldCountdown';
import { QrScanner } from '@/components/parking/QrScanner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';

import { parkingApi } from './parking-api';

const pendingFetcher = (signal: AbortSignal) => parkingApi.pendingArrivals(signal);

/**
 * Security's side of the visitor flow: a visitor reserved a space on the website; Security finds
 * the arrival (QR, vehicle number, or the waiting list), checks the vehicle against what the
 * server shows and starts the session. Nothing starts until the guard confirms.
 */
export function ArrivalsPanel() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const pending = useApiQuery(pendingFetcher, { refreshIntervalMs: 15_000 });

  const [scanning, setScanning] = useState(false);
  const [plate, setPlate] = useState('');
  const [arrival, setArrival] = useState<ArrivalView | null>(null);
  const [started, setStarted] = useState<ParkingSessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const plateRef = useRef<HTMLInputElement | null>(null);
  // A camera can read the same QR several times; only one request runs at a time.
  const inFlight = useRef(false);

  const run = async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (caught) {
      setError(caught);
      return undefined;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const find = async (body: { qr: string } | { vehicleNumber: string }) => {
    setStarted(null);
    const result = await run(() => parkingApi.findArrival(body));
    if (result) setArrival(result.arrival);
  };

  const submitPlate = (event: FormEvent) => {
    event.preventDefault();
    if (plate.trim().length >= 4) void find({ vehicleNumber: plate.trim() });
  };

  const activate = async () => {
    if (!arrival) return;
    const result = await run(() => parkingApi.activateArrival(arrival.reservationId));
    if (result) {
      setStarted(result.session);
      setArrival(null);
      setPlate('');
      pending.reload();
    }
  };

  const open = arrival?.status === 'HELD';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRoundCheck className="size-5 text-brand" aria-hidden />
          {t('arrivals.title')}
        </CardTitle>
        <CardDescription>{t('arrivals.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {scanning && (
          <QrScanner
            onScan={(value) => {
              setScanning(false);
              void find({ qr: value });
            }}
            onCancel={() => setScanning(false)}
            onUseCode={() => {
              setScanning(false);
              window.setTimeout(() => plateRef.current?.focus(), 0);
            }}
          />
        )}

        {!scanning && (
          <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
            <Button
              size="lg"
              className="h-12"
              disabled={busy}
              onClick={() => {
                setError(null);
                setScanning(true);
              }}
            >
              <Camera aria-hidden />
              {t('arrivals.scan')}
            </Button>
            <form onSubmit={submitPlate} className="flex gap-2">
              <div className="grid flex-1 gap-1">
                <Label htmlFor="arrival-plate" className="sr-only">
                  {t('arrivals.lookupLabel')}
                </Label>
                <Input
                  id="arrival-plate"
                  ref={plateRef}
                  value={plate}
                  onChange={(event) => setPlate(event.target.value.toUpperCase())}
                  placeholder={t('arrivals.lookupLabel')}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-12 font-mono"
                />
              </div>
              <Button type="submit" variant="secondary" size="lg" className="h-12" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : (
                  <Search aria-hidden />
                )}
                {t('arrivals.lookup')}
              </Button>
            </form>
          </div>
        )}

        {error !== null && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{errorMessage(t, error)}</AlertDescription>
          </Alert>
        )}

        {started && (
          <Alert variant="success">
            <CircleCheck aria-hidden />
            <AlertTitle>{t('arrivals.activated', { slot: started.slotCode })}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                {started.vehicleNumber} · {started.block.name}
              </p>
              <Button asChild size="sm" variant="outline" className="bg-background">
                <Link to={areaPaths(user.role).session(started.sessionNumber)}>
                  {t('arrivals.viewSession')}
                </Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {arrival && (
          <div className="space-y-4 rounded-xl border-2 border-brand/40 bg-brand/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {t('arrivals.detailTitle')}
                </p>
                <p className="font-mono text-3xl font-extrabold tracking-wide">
                  {arrival.vehicleNumber}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t(`vehicleTypes.${arrival.vehicleType}`)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {t('arrivals.assignedSlot')}
                </p>
                <p className="font-mono text-4xl leading-none font-extrabold">{arrival.slotCode}</p>
                <p className="text-sm text-muted-foreground">{arrival.block.name}</p>
              </div>
            </div>

            <p className="flex items-center gap-1.5 text-sm">
              <Phone className="size-4 text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">{t('arrivals.phone')}:</span>
              <a href={`tel:${arrival.contactPhone}`} className="font-medium underline">
                {arrival.contactPhone}
              </a>
            </p>

            {open ? (
              <>
                <HoldCountdown
                  expiresAt={arrival.expiresAt}
                  totalSeconds={Math.max(
                    1,
                    Math.round(
                      (Date.parse(arrival.expiresAt) - Date.parse(arrival.createdAt)) / 1000,
                    ),
                  )}
                  label={t('arrivals.holdLeft')}
                  onExpire={() => {
                    setArrival(null);
                    pending.reload();
                  }}
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    variant="brand"
                    size="lg"
                    className="h-12 flex-1"
                    disabled={busy}
                    onClick={() => void activate()}
                  >
                    {busy ? (
                      <LoaderCircle className="animate-spin" aria-hidden />
                    ) : (
                      <KeyRound aria-hidden />
                    )}
                    {t('arrivals.activate')}
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-12"
                    onClick={() => setArrival(null)}
                  >
                    {t('arrivals.clear')}
                  </Button>
                </div>
              </>
            ) : (
              <Alert variant="info">
                <CircleCheck aria-hidden />
                <AlertDescription className="space-y-2">
                  <p>{t('arrivals.alreadyActive')}</p>
                  {arrival.sessionNumber && (
                    <Button asChild size="sm" variant="outline" className="bg-background">
                      <Link to={areaPaths(user.role).session(arrival.sessionNumber)}>
                        {t('arrivals.viewSession')}
                      </Link>
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <section aria-labelledby="arrivals-waiting" className="space-y-2">
          <h3 id="arrivals-waiting" className="text-sm font-semibold">
            {t('arrivals.pending')}
          </h3>
          {pending.status === 'success' && pending.data.arrivals.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('arrivals.none')}</p>
          )}
          {pending.status === 'success' && pending.data.arrivals.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {pending.data.arrivals.map((item) => (
                <li key={item.reservationId}>
                  <button
                    type="button"
                    onClick={() => {
                      setStarted(null);
                      setError(null);
                      setArrival(item);
                    }}
                    className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border bg-card px-3.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <span className="font-mono font-bold">{item.vehicleNumber}</span>
                    <span className="text-sm text-muted-foreground">
                      {item.slotCode} · {item.block.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
