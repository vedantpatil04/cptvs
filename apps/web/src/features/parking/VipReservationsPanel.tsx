import type { ParkingSessionView, SlotReservationView, VehicleType } from '@cpvts/shared';
import { Crown, LoaderCircle, Plus } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { areaPaths } from '@/app/paths';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/choice-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';

import { parkingApi } from './parking-api';

type Dialogs =
  | { kind: 'reserve' }
  | { kind: 'release'; reservation: SlotReservationView }
  | { kind: 'checkin'; reservation: SlotReservationView }
  | null;

/**
 * VIP / emergency slot reservations. Security reserves one specific free slot (with the guest,
 * purpose and reason), checks the designated vehicle in through the normal session flow and
 * explicitly unreserves it; every change asks for confirmation. Administrators get the same list
 * and history read-only.
 */
export function VipReservationsPanel({ readOnly = false }: { readOnly?: boolean }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const { user } = useCurrentUser();
  const [history, setHistory] = useState(false);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [started, setStarted] = useState<ParkingSessionView | null>(null);

  const list = useApiQuery(
    useMemo(() => (signal: AbortSignal) => parkingApi.vipReservations(history, signal), [history]),
    { refreshIntervalMs: 20_000 },
  );
  const reservations = list.status === 'success' ? list.data.reservations : [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Crown className="size-5 text-reserved" aria-hidden />
            {t('vip.title')}
          </CardTitle>
          <CardDescription>{t('vip.description')}</CardDescription>
        </div>
        {!readOnly && (
          <Button size="lg" className="h-11" onClick={() => setDialog({ kind: 'reserve' })}>
            <Plus aria-hidden />
            {t('vip.reserveButton')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {started && (
          <Alert variant="success">
            <AlertTitle>{t('vip.checkedIn', { slot: started.slotCode })}</AlertTitle>
            <AlertDescription>
              <Button asChild size="sm" variant="outline" className="mt-1 bg-background">
                <Link to={areaPaths(user.role).session(started.sessionNumber)}>
                  {t('vip.openSession')}
                </Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {list.status === 'error' && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(t, list.error)}</AlertDescription>
          </Alert>
        )}
        {list.status === 'success' && reservations.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('vip.none')}</p>
        )}

        <ul className="space-y-2">
          {reservations.map((row) => {
            const active = row.status === 'ACTIVE';
            const parked = active && row.slotStatus === 'OCCUPIED';
            return (
              <li
                key={row.id}
                className="flex flex-col gap-3 rounded-xl border bg-card p-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-2xl font-extrabold">{row.slotCode}</span>
                    <StatusBadge tone={active ? (parked ? 'danger' : 'info') : 'neutral'} dot>
                      {!active
                        ? t('vip.stateReleased')
                        : parked
                          ? t('vip.stateParked')
                          : t('vip.stateReserved')}
                    </StatusBadge>
                    <span className="text-sm text-muted-foreground">
                      {row.block.name} · {t(`vehicleTypes.${row.vehicleType}`)}
                    </span>
                  </div>
                  <p className="text-sm">
                    <span className="font-medium">{row.guestName}</span>
                    {' · '}
                    {row.vehicleNumber ? (
                      <span className="font-mono">{row.vehicleNumber}</span>
                    ) : (
                      <span className="text-muted-foreground">{t('vip.anyVehicle')}</span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">{row.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('vip.reservedBy', {
                      name: row.reservedByName,
                      time: format.dateTime(row.reservedAt),
                    })}
                    {row.releasedAt && (
                      <>
                        <br />
                        {t('vip.releasedBy', {
                          name: row.releasedByName ?? '—',
                          time: format.dateTime(row.releasedAt),
                        })}
                        {row.releaseNote ? ` · ${row.releaseNote}` : ''}
                      </>
                    )}
                  </p>
                </div>
                {!readOnly && active && (
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    {!parked && (
                      <Button
                        variant="brand"
                        className="h-11"
                        onClick={() => setDialog({ kind: 'checkin', reservation: row })}
                      >
                        {t('vip.checkIn')}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="h-11"
                      disabled={parked}
                      title={parked ? t('errors.VIP_SLOT_IN_USE') : undefined}
                      onClick={() => setDialog({ kind: 'release', reservation: row })}
                    >
                      {t('vip.unreserve')}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <Button variant="ghost" size="sm" onClick={() => setHistory((value) => !value)}>
          {history ? t('vip.historyHide') : t('vip.historyShow')}
        </Button>
      </CardContent>

      <ReserveDialog
        open={dialog?.kind === 'reserve'}
        onClose={() => setDialog(null)}
        onDone={() => {
          setDialog(null);
          list.reload();
        }}
      />
      {dialog?.kind === 'release' && (
        <ReleaseDialog
          reservation={dialog.reservation}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            list.reload();
          }}
        />
      )}
      {dialog?.kind === 'checkin' && (
        <CheckInDialog
          reservation={dialog.reservation}
          onClose={() => setDialog(null)}
          onDone={(session) => {
            setDialog(null);
            setStarted(session);
            list.reload();
          }}
        />
      )}
    </Card>
  );
}

const mapFetcher = (signal: AbortSignal) => parkingApi.map(signal);

function ReserveDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const map = useApiQuery(mapFetcher);
  const [slotCode, setSlotCode] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [guestName, setGuestName] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Only slots that are free right now can be reserved; the server enforces it again.
  const free = useMemo(() => {
    if (map.status !== 'success') return [];
    return map.data.blocks.flatMap((block) =>
      block.zones.flatMap((zone) =>
        zone.slots
          .filter((slot) => slot.status === 'AVAILABLE')
          .map((slot) => ({ code: slot.code, label: `${slot.code} · ${block.name}` })),
      ),
    );
  }, [map]);

  const reset = () => {
    setSlotCode('');
    setVehicleNumber('');
    setGuestName('');
    setReason('');
    setConfirming(false);
    setError(null);
  };

  const review = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (slotCode && guestName.trim().length >= 2 && reason.trim().length >= 3) setConfirming(true);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await parkingApi.reserveSlot({
        slotCode,
        vehicleNumber: vehicleNumber.trim() || undefined,
        guestName: guestName.trim(),
        reason: reason.trim(),
      });
      reset();
      onDone();
    } catch (caught) {
      setError(caught);
      setConfirming(false);
      map.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent closeLabel={t('common.close')}>
        {confirming ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('vip.confirmTitle', { slot: slotCode })}</DialogTitle>
              <DialogDescription>{t('vip.confirmBody', { slot: slotCode })}</DialogDescription>
            </DialogHeader>
            <dl className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
              <div>
                <dt className="inline text-muted-foreground">{t('vip.guestName')}: </dt>
                <dd className="inline font-medium">{guestName}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">{t('vip.vehicleNumber')}: </dt>
                <dd className="inline font-mono">{vehicleNumber.trim() || t('vip.anyVehicle')}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">{t('vip.reason')}: </dt>
                <dd className="inline">{reason}</dd>
              </div>
            </dl>
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-11" onClick={() => setConfirming(false)}>
                {t('vip.back')}
              </Button>
              <Button
                variant="brand"
                className="h-11"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy && <LoaderCircle className="animate-spin" aria-hidden />}
                {t('vip.confirm')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={review} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t('vip.reserveButton')}</DialogTitle>
              <DialogDescription>{t('vip.description')}</DialogDescription>
            </DialogHeader>
            {error !== null && (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(t, error)}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-2">
              <Label htmlFor="vip-slot">{t('vip.slot')}</Label>
              <NativeSelect
                id="vip-slot"
                value={slotCode}
                onChange={(event) => setSlotCode(event.target.value)}
                required
                className="h-11"
              >
                <option value="">
                  {map.status === 'success' && free.length === 0
                    ? t('vip.noFreeSlots')
                    : t('vip.slotPlaceholder')}
                </option>
                {free.map((slot) => (
                  <option key={slot.code} value={slot.code}>
                    {slot.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vip-vehicle">{t('vip.vehicleNumber')}</Label>
              <Input
                id="vip-vehicle"
                value={vehicleNumber}
                onChange={(event) => setVehicleNumber(event.target.value.toUpperCase())}
                placeholder="KA22AB1234"
                autoComplete="off"
                spellCheck={false}
                className="h-11 font-mono"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vip-guest">{t('vip.guestName')}</Label>
              <Input
                id="vip-guest"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                required
                minLength={2}
                maxLength={120}
                className="h-11"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="vip-reason">{t('vip.reason')}</Label>
              <Input
                id="vip-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                minLength={3}
                maxLength={300}
                className="h-11"
              />
              <p className="text-xs text-muted-foreground">{t('vip.reasonHint')}</p>
            </div>
            <DialogFooter>
              <Button type="submit" size="lg" className="h-12 w-full sm:w-auto">
                {t('vip.review')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReleaseDialog({
  reservation,
  onClose,
  onDone,
}: {
  reservation: SlotReservationView;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await parkingApi.releaseSlot(reservation.id, { note: note.trim() || undefined });
      onDone();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('vip.releaseTitle', { slot: reservation.slotCode })}</DialogTitle>
          <DialogDescription>
            {t('vip.releaseBody', { slot: reservation.slotCode })}
          </DialogDescription>
        </DialogHeader>
        {error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(t, error)}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-2">
          <Label htmlFor="vip-release-note">{t('vip.releaseNote')}</Label>
          <Input
            id="vip-release-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={300}
            className="h-11"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            className="h-11"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy && <LoaderCircle className="animate-spin" aria-hidden />}
            {t('vip.releaseConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckInDialog({
  reservation,
  onClose,
  onDone,
}: {
  reservation: SlotReservationView;
  onClose: () => void;
  onDone: (session: ParkingSessionView) => void;
}) {
  const { t } = useTranslation();
  const [vehicleNumber, setVehicleNumber] = useState(reservation.vehicleNumber ?? '');
  const [ownerCategory, setOwnerCategory] = useState<'STAFF' | 'VISITOR'>('STAFF');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const designated = reservation.vehicleNumber !== null;
  const vehicleType: VehicleType = reservation.vehicleType;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await parkingApi.vipCheckIn(reservation.id, {
        vehicleNumber: vehicleNumber.trim(),
        vehicleType,
        ownerCategory,
        confirmOfficialGuest: confirmed,
      });
      onDone(result.session);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('vip.checkInTitle', { slot: reservation.slotCode })}</DialogTitle>
            <DialogDescription>
              {reservation.guestName} · {reservation.reason}
            </DialogDescription>
          </DialogHeader>
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(t, error)}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <Label htmlFor="vip-checkin-vehicle">{t('vip.checkInVehicle')}</Label>
            <Input
              id="vip-checkin-vehicle"
              value={vehicleNumber}
              onChange={(event) => setVehicleNumber(event.target.value.toUpperCase())}
              required
              autoComplete="off"
              spellCheck={false}
              className="h-11 font-mono"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vip-checkin-category">{t('vip.checkInCategory')}</Label>
            <NativeSelect
              id="vip-checkin-category"
              value={ownerCategory}
              onChange={(event) => setOwnerCategory(event.target.value as 'STAFF' | 'VISITOR')}
              className="h-11"
            >
              <option value="STAFF">{t('vip.categoryStaff')}</option>
              <option value="VISITOR">{t('vip.categoryVisitor')}</option>
            </NativeSelect>
          </div>
          {!designated && (
            <label className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5 size-5"
              />
              <span>
                {t('vip.confirmGuest', {
                  guest: reservation.guestName,
                  reason: reservation.reason,
                })}
              </span>
            </label>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="brand"
              className="h-11"
              disabled={busy || (!designated && !confirmed)}
            >
              {busy && <LoaderCircle className="animate-spin" aria-hidden />}
              {t('vip.checkInSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
