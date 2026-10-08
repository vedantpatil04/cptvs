import {
  blockLocationRequestSchema,
  blockSlotRequestSchema,
  slotPriorityRequestSchema,
  type ManagedLayout,
  type ManagedSlot,
} from '@cpvts/shared';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';

import { adminApi } from './admin-api';

export type SlotAction =
  | { kind: 'block' | 'unblock' | 'priority'; slot: ManagedSlot }
  | { kind: 'location'; block: ManagedLayout['blocks'][number] };

interface SlotActionDialogProps {
  action: SlotAction | null;
  onClose: () => void;
  /** Called with a translated confirmation after the server accepted the change. */
  onDone: (message: string) => void;
}

/** Confirms and submits one slot-management change. The server re-validates everything. */
export function SlotActionDialog({ action, onClose, onDone }: SlotActionDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={action !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        {action && (
          // Remount per action so form state never leaks between slots.
          <ActionForm
            key={action.kind === 'location' ? action.block.code : action.slot.code + action.kind}
            action={action}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const firstIssue = (result: z.ZodSafeParseResult<unknown>): string | null =>
  result.success ? null : (result.error.issues[0]?.message ?? 'validation.required');

/** Parses an optional decimal input: '' → null, otherwise a number (NaN if invalid). */
const toCoordinate = (value: string): number | null =>
  value.trim() === '' ? null : Number(value.trim());

function ActionForm({
  action,
  onDone,
}: {
  action: SlotAction;
  onDone: SlotActionDialogProps['onDone'];
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState(
    action.kind === 'location' ? '' : `${action.slot.priority}`,
  );
  const coordinates = action.kind === 'location' ? action.block.coordinates : null;
  const [latitude, setLatitude] = useState(coordinates ? `${coordinates.latitude}` : '');
  const [longitude, setLongitude] = useState(coordinates ? `${coordinates.longitude}` : '');

  const run = async (request: () => Promise<unknown>, message: string) => {
    setPending(true);
    setError(null);
    try {
      await request();
      onDone(message);
    } catch (failure) {
      setError(errorMessage(t, failure));
      setPending(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    switch (action.kind) {
      case 'block': {
        const parsed = blockSlotRequestSchema.safeParse({ reason });
        if (!parsed.success) return setError(t(firstIssue(parsed) as never));
        return void run(
          () => adminApi.blockSlot(action.slot.code, parsed.data.reason),
          t('slots.blocked', { slot: action.slot.code }),
        );
      }
      case 'unblock':
        return void run(
          () => adminApi.unblockSlot(action.slot.code),
          t('slots.unblocked', { slot: action.slot.code }),
        );
      case 'priority': {
        const parsed = slotPriorityRequestSchema.safeParse({
          priority: priority.trim() === '' ? Number.NaN : Number(priority),
        });
        if (!parsed.success) return setError(t(firstIssue(parsed) as never));
        return void run(
          () => adminApi.setSlotPriority(action.slot.code, parsed.data.priority),
          t('slots.prioritySaved', { slot: action.slot.code, priority: parsed.data.priority }),
        );
      }
      case 'location':
        return saveLocation(toCoordinate(latitude), toCoordinate(longitude));
    }
  };

  const saveLocation = (lat: number | null, lng: number | null) => {
    if (action.kind !== 'location') return;
    const parsed = blockLocationRequestSchema.safeParse({ latitude: lat, longitude: lng });
    if (!parsed.success) return setError(t(firstIssue(parsed) as never));
    void run(
      () =>
        adminApi.setBlockLocation(action.block.code, parsed.data.latitude, parsed.data.longitude),
      t(parsed.data.latitude === null ? 'slots.locationRemoved' : 'slots.locationSaved', {
        block: action.block.name,
      }),
    );
  };

  const title =
    action.kind === 'location'
      ? t('slots.locationTitle', { block: action.block.name })
      : t(`slots.${action.kind}Title`, { slot: action.slot.code });
  const description =
    action.kind === 'location' ? t('slots.locationHint') : t(`slots.${action.kind}Hint`);

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      {action.kind === 'block' && (
        <div className="space-y-1.5">
          <Label htmlFor="block-reason">{t('slots.reason')}</Label>
          <Input
            id="block-reason"
            value={reason}
            maxLength={255}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('slots.reasonPlaceholder')}
            autoFocus
          />
        </div>
      )}
      {action.kind === 'priority' && (
        <div className="space-y-1.5">
          <Label htmlFor="slot-priority">{t('slots.priority')}</Label>
          <Input
            id="slot-priority"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            autoFocus
          />
        </div>
      )}
      {action.kind === 'location' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="block-latitude">{t('slots.latitude')}</Label>
            <Input
              id="block-latitude"
              inputMode="decimal"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              placeholder="15.8497"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="block-longitude">{t('slots.longitude')}</Label>
            <Input
              id="block-longitude"
              inputMode="decimal"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              placeholder="74.4977"
            />
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        {action.kind === 'location' && action.block.coordinates && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => saveLocation(null, null)}
            className="sm:mr-auto"
          >
            {t('slots.removeLocation')}
          </Button>
        )}
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            {t('common.cancel')}
          </Button>
        </DialogClose>
        <Button
          type="submit"
          variant={action.kind === 'block' ? 'destructive' : 'default'}
          disabled={pending}
        >
          {pending && <LoaderCircle className="animate-spin" aria-hidden />}
          {t(`slots.confirm.${action.kind}`)}
        </Button>
      </DialogFooter>
    </form>
  );
}
