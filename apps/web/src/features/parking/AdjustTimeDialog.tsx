import type { CheckoutQuote } from '@cpvts/shared';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { campusLocalToIso, isoToCampusLocal } from '@/lib/duration';
import { errorMessage } from '@/lib/error-message';
import { serverNow } from '@/lib/server-clock';

import { parkingApi } from './parking-api';

interface AdjustTimeDialogProps {
  sessionNumber: string;
  /** The recorded entry instant and the exit instant captured at the gate (ISO). */
  entryAt: string;
  exitAt: string;
  onClose: () => void;
  /** The server's fresh pricing of the corrected times. */
  onAdjusted: (quote: CheckoutQuote) => void;
}

/**
 * Security's correction of the recorded entry and exit times before the final checkout. The
 * times are edited on the campus clock; the server checks them again, records the original and
 * corrected values with the reason, and prices the stay afresh — no fee is ever sent from here.
 */
export function AdjustTimeDialog({
  sessionNumber,
  entryAt,
  exitAt,
  onClose,
  onAdjusted,
}: AdjustTimeDialogProps) {
  const { t } = useTranslation();
  const [entryLocal, setEntryLocal] = useState(() => isoToCampusLocal(entryAt));
  const [exitLocal, setExitLocal] = useState(() => isoToCampusLocal(exitAt));
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inFlight = useRef(false);

  // An untouched field keeps its exact recorded instant (the inputs only show whole minutes).
  const entryIso = entryLocal === isoToCampusLocal(entryAt) ? entryAt : toIso(entryLocal);
  const exitIso = exitLocal === isoToCampusLocal(exitAt) ? exitAt : toIso(exitLocal);
  const unchanged = entryIso === entryAt && exitIso === exitAt;

  // The same rules the server enforces, so the guard sees the problem before saving.
  const problem:
    'required' | 'ENTRY_AFTER_EXIT' | 'EXIT_IN_FUTURE' | 'TIME_RANGE_OVERNIGHT' | null =
    !entryIso || !exitIso
      ? 'required'
      : Date.parse(entryIso) > Date.parse(exitIso)
        ? 'ENTRY_AFTER_EXIT'
        : Date.parse(exitIso) > serverNow()
          ? 'EXIT_IN_FUTURE'
          : entryLocal.slice(0, 10) !== exitLocal.slice(0, 10)
            ? 'TIME_RANGE_OVERNIGHT'
            : null;
  const canSave =
    !submitting && !unchanged && problem === null && confirmed && reason.trim().length >= 3;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || inFlight.current || !entryIso || !exitIso) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const { quote } = await parkingApi.adjustTime(sessionNumber, {
        entryAt: entryIso,
        exitAt: exitIso,
        reason: reason.trim(),
        confirm: true,
      });
      onAdjusted(quote);
    } catch (caught) {
      setError(caught);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('parking.adjust.title')}</DialogTitle>
            <DialogDescription>{t('parking.adjust.description')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="adjust-entry">{t('parking.adjust.entry')}</Label>
              <Input
                id="adjust-entry"
                type="datetime-local"
                className="h-11"
                value={entryLocal}
                onChange={(event) => setEntryLocal(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adjust-exit">{t('parking.adjust.exit')}</Label>
              <Input
                id="adjust-exit"
                type="datetime-local"
                className="h-11"
                value={exitLocal}
                max={isoToCampusLocal(new Date(serverNow()).toISOString())}
                onChange={(event) => setExitLocal(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="adjust-reason">{t('parking.adjust.reason')}</Label>
              <Input
                id="adjust-reason"
                className="h-11"
                value={reason}
                maxLength={200}
                placeholder={t('parking.adjust.reasonPlaceholder')}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <label className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5 size-5"
              />
              <span>{t('parking.adjust.confirm')}</span>
            </label>
          </div>

          {problem !== null && problem !== 'required' && (
            <Alert variant="warning">
              <CircleAlert aria-hidden />
              <AlertDescription>{t(`errors.${problem}`)}</AlertDescription>
            </Alert>
          )}
          {error !== null && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{errorMessage(t, error)}</AlertDescription>
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">{t('parking.adjust.feeNote')}</p>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
              {t('parking.adjust.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A campus-clock `YYYY-MM-DDTHH:mm` as an instant, or null while the field is empty or invalid. */
const toIso = (local: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const iso = campusLocalToIso(local);
  return Number.isNaN(Date.parse(iso)) ? null : iso;
};
