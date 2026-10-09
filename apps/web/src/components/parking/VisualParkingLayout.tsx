import type { Coordinates, ParkingMapOccupant, SlotStatus, VehicleType } from '@cpvts/shared';
import { Bike, Car, MapPin, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { BlockMapLink } from './BlockMapLink';
import { SLOT_TONE } from './slot-tone';
import {
  countSlotStates,
  SLOT_STATE_STYLE,
  type SlotCountValues,
  type SlotTileState,
} from './slot-state';
import { SlotCountChips, SlotTile } from './SlotTile';
import { cn } from '@/lib/utils';

export interface VisualSlotItem {
  code: string;
  status: SlotStatus;
  blockedReason?: string | null;
  occupant?: ParkingMapOccupant | null;
  priority?: number;
  isEnabled?: boolean;
  archivedAt?: string | null;
  hasHistory?: boolean;
  holdExpiresAt?: string | null;
}

export interface VisualZoneItem {
  code: string;
  name: string;
  vehicleType: VehicleType;
  counts?: { total: number; available: number; occupied: number; blocked: number; held?: number };
  slots: VisualSlotItem[];
}

export interface VisualBlockItem {
  code: string;
  name: string;
  description?: string | null;
  coordinates?: Coordinates | null;
  zones: VisualZoneItem[];
}

export interface VisualParkingLayoutProps {
  blocks: VisualBlockItem[];
  userSlotCodes?: string[];
  highlightSlot?: string | null;
  onSelectSlot?: (slot: VisualSlotItem, zone: VisualZoneItem, block: VisualBlockItem) => void;
  adminMode?: boolean;
  onAdminSlotClick?: (slot: VisualSlotItem, zone: VisualZoneItem, block: VisualBlockItem) => void;
  onAdminAddSlot?: (zone: VisualZoneItem, block: VisualBlockItem) => void;
  informationalClick?: boolean;
}

/** What the tile shows: a slot an admin switched off or archived is "disabled", whatever its status. */
const tileState = (slot: VisualSlotItem): SlotTileState =>
  slot.isEnabled === false || slot.archivedAt ? 'DISABLED' : slot.status;

/** Server counts are authoritative; disabled slots are not part of them, so those are derived. */
const zoneCounts = (zone: VisualZoneItem): SlotCountValues => {
  const derived = countSlotStates(zone.slots.map(tileState));
  if (!zone.counts) return derived;
  return {
    total: zone.counts.total,
    available: zone.counts.available,
    held: zone.counts.held ?? derived.held,
    occupied: zone.counts.occupied,
    blocked: zone.counts.blocked,
    disabled: derived.disabled,
  };
};

const sumCounts = (list: SlotCountValues[]): SlotCountValues =>
  list.reduce<SlotCountValues>(
    (sum, counts) => ({
      total: sum.total + counts.total,
      available: sum.available + counts.available,
      held: sum.held + counts.held,
      occupied: sum.occupied + counts.occupied,
      blocked: sum.blocked + counts.blocked,
      disabled: sum.disabled + counts.disabled,
    }),
    { total: 0, available: 0, held: 0, occupied: 0, blocked: 0, disabled: 0 },
  );

const LEGEND: SlotTileState[] = ['AVAILABLE', 'HELD', 'OCCUPIED', 'BLOCKED', 'DISABLED'];

/**
 * The parking layout: block → zone → slot tiles. Slot availability comes from the server; this
 * component only draws it. Tiles are large, labelled with the slot ID and a text status, and the
 * zone and block headers carry the live counts.
 */
export function VisualParkingLayout({
  blocks,
  userSlotCodes = [],
  highlightSlot,
  onSelectSlot,
  adminMode = false,
  onAdminSlotClick,
  onAdminAddSlot,
  informationalClick = true,
}: VisualParkingLayoutProps) {
  const { t } = useTranslation();
  const highlightRef = useRef<HTMLButtonElement | null>(null);
  const [infoDialogSlot, setInfoDialogSlot] = useState<{
    slot: VisualSlotItem;
    zone: VisualZoneItem;
    block: VisualBlockItem;
  } | null>(null);

  useEffect(() => {
    if (highlightSlot && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightSlot]);

  const handleSlotClick = (slot: VisualSlotItem, zone: VisualZoneItem, block: VisualBlockItem) => {
    if (adminMode && onAdminSlotClick) {
      onAdminSlotClick(slot, zone, block);
      return;
    }
    onSelectSlot?.(slot, zone, block);
    if (!adminMode && informationalClick) setInfoDialogSlot({ slot, zone, block });
  };

  const showDisabledInLegend =
    adminMode ||
    blocks.some((b) => b.zones.some((z) => z.slots.some((s) => tileState(s) === 'DISABLED')));

  return (
    <div className="space-y-6">
      <ul
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm"
        aria-label={t('parking.live.legend')}
      >
        {LEGEND.filter((state) => state !== 'DISABLED' || showDisabledInLegend).map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <span
              className={cn('size-4 rounded-sm border-2', SLOT_STATE_STYLE[state].swatch)}
              aria-hidden
            />
            {t(`parking.slotStatus.${state}`)}
          </li>
        ))}
        {userSlotCodes.length > 0 && (
          <li className="flex items-center gap-1.5 font-semibold text-primary">
            <MapPin className="size-4" aria-hidden />
            {t('parking.slotTile.yourVehicle')}
          </li>
        )}
      </ul>

      {blocks.map((block) => {
        const blockCounts = sumCounts(block.zones.map(zoneCounts));
        return (
          <section
            key={block.code}
            aria-labelledby={`block-${block.code}`}
            className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <h3
                  id={`block-${block.code}`}
                  className="flex items-center gap-2 text-lg font-bold tracking-tight"
                >
                  <MapPin className="size-5 shrink-0 text-primary" aria-hidden />
                  {block.name}
                </h3>
                {block.description && (
                  <p className="text-sm text-muted-foreground">{block.description}</p>
                )}
                <SlotCountChips counts={blockCounts} />
              </div>
              <BlockMapLink coordinates={block.coordinates ?? null} />
            </div>

            {block.zones.map((zone) => {
              const Icon = zone.vehicleType === 'TWO_WHEELER' ? Bike : Car;
              const counts = zoneCounts(zone);
              return (
                <div key={zone.code} className="rounded-xl border bg-muted/30 p-3 sm:p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="flex items-center gap-2 font-semibold">
                      <Icon className="size-5 text-primary" aria-hidden />
                      {zone.name}
                      <span className="text-sm font-normal text-muted-foreground">
                        · {t(`vehicleTypes.${zone.vehicleType}`)}
                      </span>
                    </h4>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">
                        {t('parking.live.zoneCounts', {
                          available: counts.available,
                          total: counts.total,
                        })}
                      </span>
                      {adminMode && onAdminAddSlot && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9"
                          onClick={() => onAdminAddSlot(zone, block)}
                        >
                          <Plus aria-hidden />
                          {t('parking.slotTile.addSlot')}
                        </Button>
                      )}
                    </div>
                  </div>
                  <SlotCountChips counts={counts} className="mb-3" />

                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
                    {zone.slots.map((slot) => {
                      const mine = userSlotCodes.includes(slot.code);
                      const highlighted = slot.code === highlightSlot;
                      const state = tileState(slot);
                      const note = slot.archivedAt
                        ? t('parking.slotTile.archived')
                        : state === 'BLOCKED'
                          ? slot.blockedReason
                          : adminMode && typeof slot.priority === 'number'
                            ? t('parking.slotTile.priority', { count: slot.priority })
                            : null;
                      return (
                        <li key={slot.code}>
                          <SlotTile
                            ref={highlighted ? highlightRef : undefined}
                            code={slot.code}
                            state={state}
                            vehicleType={zone.vehicleType}
                            vehicleNumber={
                              state === 'OCCUPIED' ? slot.occupant?.vehicleNumber : null
                            }
                            note={note}
                            mine={mine}
                            highlighted={highlighted}
                            onClick={() => handleSlotClick(slot, zone, block)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}

      <Dialog
        open={infoDialogSlot !== null}
        onOpenChange={(open) => !open && setInfoDialogSlot(null)}
      >
        <DialogContent closeLabel={t('common.close')}>
          {infoDialogSlot && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-lg">
                  <span className="font-mono font-bold text-primary">
                    {infoDialogSlot.slot.code}
                  </span>
                  <span>· {infoDialogSlot.block.name}</span>
                </DialogTitle>
                <DialogDescription>
                  {infoDialogSlot.zone.name} ·{' '}
                  {t(`vehicleTypes.${infoDialogSlot.zone.vehicleType}`)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 py-1">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm text-muted-foreground">
                    {t('parking.common.status')}
                  </span>
                  <StatusBadge tone={SLOT_TONE[infoDialogSlot.slot.status]} dot>
                    {t(`parking.slotStatus.${infoDialogSlot.slot.status}`)}
                  </StatusBadge>
                </div>

                {infoDialogSlot.slot.status === 'AVAILABLE' && (
                  <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                    {t('parking.slotTile.availableNote')}
                  </p>
                )}

                {infoDialogSlot.slot.occupant && (
                  <dl className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t('parking.common.vehicleNumber')}</dt>
                      <dd className="font-mono font-bold">
                        {infoDialogSlot.slot.occupant.vehicleNumber}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t('parking.common.duration')}</dt>
                      <dd>
                        {t('parking.common.hours', {
                          count: infoDialogSlot.slot.occupant.currentDurationHours,
                        })}
                      </dd>
                    </div>
                  </dl>
                )}

                {infoDialogSlot.slot.blockedReason && (
                  <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
                    <strong>{t('parking.live.blockedReason')}:</strong>{' '}
                    {infoDialogSlot.slot.blockedReason}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button onClick={() => setInfoDialogSlot(null)}>{t('common.close')}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
