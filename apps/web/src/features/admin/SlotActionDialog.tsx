import {
  blockLocationRequestSchema,
  blockSlotRequestSchema,
  createSlotRequestSchema,
  slotPriorityRequestSchema,
  updateSlotRequestSchema,
  type ManagedBlock,
  type ManagedLayout,
  type ManagedSlot,
  type ManagedZone,
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
  | {
      kind:
        | 'block'
        | 'unblock'
        | 'priority'
        | 'enable'
        | 'disable'
        | 'archive'
        | 'restore'
        | 'delete'
        | 'edit';
      slot: ManagedSlot;
    }
  | { kind: 'create'; zone: ManagedZone; block: ManagedBlock }
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
          <ActionForm
            key={
              action.kind === 'location'
                ? action.block.code
                : action.kind === 'create'
                  ? `${action.zone.code}-create`
                  : `${action.slot.code}-${action.kind}`
            }
            action={action}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const firstIssue = (result: z.ZodSafeParseResult<unknown>): string =>
  result.success ? '' : result.error.issues[0]?.message ?? 'validation.required';

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

  // Form states
  const [code, setCode] = useState('');
  const [reason, setReason] = useState(
    action.kind !== 'location' && action.kind !== 'create' ? action.slot.blockedReason ?? '' : '',
  );
  const [priority, setPriority] = useState(
    action.kind === 'location' || action.kind === 'create'
      ? '0'
      : `${action.slot.priority ?? 0}`,
  );
  const [sortOrder, setSortOrder] = useState(
    action.kind !== 'location' && action.kind !== 'create' ? `${action.slot.sortOrder ?? 0}` : '0',
  );
  const [status, setStatus] = useState<'AVAILABLE' | 'BLOCKED'>('AVAILABLE');

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

    if (action.kind === 'create') {
      const parsed = createSlotRequestSchema.safeParse({
        zoneCode: action.zone.code,
        vehicleType: action.zone.vehicleType,
        code: code.trim().toUpperCase(),
        priority: priority.trim() === '' ? 0 : Number(priority),
        status,
        blockedReason: status === 'BLOCKED' ? reason.trim() : undefined,
        sortOrder: sortOrder.trim() === '' ? undefined : Number(sortOrder),
      });
      if (!parsed.success) return setError(t(firstIssue(parsed) as never));
      return void run(
        () => adminApi.createSlot(parsed.data),
        `Slot ${parsed.data.code} successfully added to ${action.zone.name}.`,
      );
    }

    if (action.kind === 'edit') {
      const parsed = updateSlotRequestSchema.safeParse({
        priority: priority.trim() === '' ? undefined : Number(priority),
        sortOrder: sortOrder.trim() === '' ? undefined : Number(sortOrder),
        blockedReason: action.slot.status === 'BLOCKED' ? reason.trim() || undefined : undefined,
      });
      if (!parsed.success) return setError(t(firstIssue(parsed) as never));
      return void run(
        () => adminApi.updateSlot(action.slot.code, parsed.data),
        `Slot ${action.slot.code} updated.`,
      );
    }

    if (action.kind === 'enable') {
      return void run(
        () => adminApi.enableSlot(action.slot.code),
        `Slot ${action.slot.code} is now enabled and in service.`,
      );
    }

    if (action.kind === 'disable') {
      return void run(
        () => adminApi.disableSlot(action.slot.code),
        `Slot ${action.slot.code} is disabled (out of service).`,
      );
    }

    if (action.kind === 'archive') {
      return void run(
        () => adminApi.archiveSlot(action.slot.code),
        `Slot ${action.slot.code} has been archived.`,
      );
    }

    if (action.kind === 'restore') {
      return void run(
        () => adminApi.restoreSlot(action.slot.code),
        `Slot ${action.slot.code} restored from archive.`,
      );
    }

    if (action.kind === 'delete') {
      return void run(async () => {
        const res = await adminApi.deleteSlot(action.slot.code);
        return res;
      }, `Slot ${action.slot.code} processed (deleted or archived).`);
    }

    if (action.kind === 'block') {
      const parsed = blockSlotRequestSchema.safeParse({ reason });
      if (!parsed.success) return setError(t(firstIssue(parsed) as never));
      return void run(
        () => adminApi.blockSlot(action.slot.code, parsed.data.reason),
        t('slots.blocked', { slot: action.slot.code }),
      );
    }

    if (action.kind === 'unblock') {
      return void run(
        () => adminApi.unblockSlot(action.slot.code),
        t('slots.unblocked', { slot: action.slot.code }),
      );
    }

    if (action.kind === 'priority') {
      const parsed = slotPriorityRequestSchema.safeParse({
        priority: priority.trim() === '' ? Number.NaN : Number(priority),
      });
      if (!parsed.success) return setError(t(firstIssue(parsed) as never));
      return void run(
        () => adminApi.setSlotPriority(action.slot.code, parsed.data.priority),
        t('slots.prioritySaved', { slot: action.slot.code, priority: parsed.data.priority }),
      );
    }

    if (action.kind === 'location') {
      const lat = toCoordinate(latitude);
      const lng = toCoordinate(longitude);
      const parsed = blockLocationRequestSchema.safeParse({ latitude: lat, longitude: lng });
      if (!parsed.success) return setError(t(firstIssue(parsed) as never));
      return void run(
        () =>
          adminApi.setBlockLocation(action.block.code, parsed.data.latitude, parsed.data.longitude),
        t(parsed.data.latitude === null ? 'slots.locationRemoved' : 'slots.locationSaved', {
          block: action.block.name,
        }),
      );
    }
  };

  const getTitleAndDescription = () => {
    switch (action.kind) {
      case 'create':
        return {
          title: `Add Parking Slot to ${action.zone.name}`,
          description: `Create a new slot (${action.zone.vehicleType === 'TWO_WHEELER' ? 'T-xx' : 'F-xx'}) that joins smart allocation immediately.`,
        };
      case 'edit':
        return {
          title: `Edit Slot ${action.slot.code}`,
          description: 'Update allocation priority or sorting order.',
        };
      case 'enable':
        return {
          title: `Enable Slot ${action.slot.code}`,
          description: 'Return this slot to service so it can be allocated.',
        };
      case 'disable':
        return {
          title: `Disable Slot ${action.slot.code}`,
          description: 'Take this slot out of service. It will not be offered for parking.',
        };
      case 'archive':
        return {
          title: `Archive Slot ${action.slot.code}`,
          description: 'Soft-delete this slot while preserving its parking history and reports.',
        };
      case 'restore':
        return {
          title: `Restore Slot ${action.slot.code}`,
          description: 'Restore this archived slot back to active service.',
        };
      case 'delete':
        return {
          title: `Safe Delete Slot ${action.slot.code}`,
          description:
            'If this slot has never been used, it will be removed completely. If it has history, it will be safely archived.',
        };
      case 'location':
        return {
          title: t('slots.locationTitle', { block: action.block.name }),
          description: t('slots.locationHint'),
        };
      case 'block':
        return {
          title: t('slots.blockTitle', { slot: action.slot.code }),
          description: t('slots.blockHint'),
        };
      case 'unblock':
        return {
          title: t('slots.unblockTitle', { slot: action.slot.code }),
          description: t('slots.unblockHint'),
        };
      case 'priority':
        return {
          title: t('slots.priorityTitle', { slot: action.slot.code }),
          description: t('slots.priorityHint'),
        };
    }
  };

  const { title, description } = getTitleAndDescription();

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      {action.kind === 'create' && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="create-slot-code">
              Slot Code ({action.zone.vehicleType === 'TWO_WHEELER' ? 'T-...' : 'F-...'})
            </Label>
            <Input
              id="create-slot-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={action.zone.vehicleType === 'TWO_WHEELER' ? 'T-11' : 'F-06'}
              autoFocus
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="create-slot-priority">Priority (0-100)</Label>
              <Input
                id="create-slot-priority"
                type="number"
                min={0}
                max={100}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-slot-status">Initial Status</Label>
              <select
                id="create-slot-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as 'AVAILABLE' | 'BLOCKED')}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="AVAILABLE">Available</option>
                <option value="BLOCKED">Blocked</option>
              </select>
            </div>
          </div>

          {status === 'BLOCKED' && (
            <div className="space-y-1.5">
              <Label htmlFor="create-slot-reason">Blocked Reason</Label>
              <Input
                id="create-slot-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Under maintenance"
                required
              />
            </div>
          )}
        </div>
      )}

      {(action.kind === 'edit' || action.kind === 'priority') && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="slot-priority">{t('slots.priority')}</Label>
            <Input
              id="slot-priority"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              autoFocus
            />
          </div>
          {action.kind === 'edit' && (
            <div className="space-y-1.5">
              <Label htmlFor="slot-sort-order">Layout Sort Order</Label>
              <Input
                id="slot-sort-order"
                type="number"
                min={0}
                max={9999}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>
          )}
          {action.kind === 'edit' && action.slot.status === 'BLOCKED' && (
            <div className="space-y-1.5">
              <Label htmlFor="slot-blocked-reason">Blocked Reason</Label>
              <Input
                id="slot-blocked-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

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
            onClick={() => {
              setLatitude('');
              setLongitude('');
              adminApi
                .setBlockLocation(action.block.code, null, null)
                .then(() => onDone(t('slots.locationRemoved', { block: action.block.name })))
                .catch((e) => setError(errorMessage(t, e)));
            }}
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
          variant={
            action.kind === 'block' || action.kind === 'delete' || action.kind === 'disable'
              ? 'destructive'
              : 'default'
          }
          disabled={pending}
        >
          {pending && <LoaderCircle className="animate-spin" aria-hidden />}
          {action.kind === 'create'
            ? 'Add Slot'
            : action.kind === 'delete'
              ? 'Delete Slot'
              : action.kind === 'archive'
                ? 'Archive Slot'
                : action.kind === 'restore'
                  ? 'Restore Slot'
                  : action.kind === 'enable'
                    ? 'Enable Slot'
                    : action.kind === 'disable'
                      ? 'Disable Slot'
                      : action.kind === 'edit'
                        ? 'Save Changes'
                        : action.kind === 'block'
                          ? t('slots.confirm.block')
                          : action.kind === 'unblock'
                            ? t('slots.confirm.unblock')
                            : action.kind === 'priority'
                              ? t('slots.confirm.priority')
                              : t('slots.confirm.location')}
        </Button>
      </DialogFooter>
    </form>
  );
}
