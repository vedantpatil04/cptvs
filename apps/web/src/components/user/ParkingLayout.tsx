import type {
  ParkingMapBlock,
  ParkingMapSlot,
  ParkingMapZone,
  PortalLayoutResponse,
} from '@cpvts/shared';
import { Bike, Car, MapPin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/feedback/StatusBadge';
import { BlockMapLink } from '@/components/parking/BlockMapLink';
import { PlateBadge } from '@/components/parking/PlateBadge';
import { SlotStatusBadge } from '@/components/parking/SlotStatusBadge';
import { SLOT_TILE, SLOT_TONE } from '@/components/parking/slot-tone';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatHour } from '@/lib/format';
import { cn } from '@/lib/utils';

const VEHICLE_ICON = { TWO_WHEELER: Bike, FOUR_WHEELER: Car } as const;

interface Selection {
  slot: ParkingMapSlot;
  zone: ParkingMapZone;
  block: ParkingMapBlock;
}

interface ParkingLayoutProps {
  layout: PortalLayoutResponse;
  /** Slot to emphasise in addition to the viewer's own slots. */
  focusSlot?: string | null;
  /** Scroll the focused slot into view when the layout first appears. */
  scrollToFocus?: boolean;
}

/**
 * The CPVTS visual slot layout (block → zone → slots) for residents and
 * visitors. Other people's vehicles are never shown: the server sends an
 * occupant only for the viewer's own slots, and this view shows nothing more
 * than a slot's status for everyone else.
 */
export function ParkingLayout({ layout, focusSlot, scrollToFocus = false }: ParkingLayoutProps) {
  const { t } = useTranslation();
  const own = new Set(layout.mySlots);
  const focus = focusSlot ?? layout.mySlots[0] ?? null;
  const focusRef = useRef<HTMLButtonElement | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    if (scrollToFocus) focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus, scrollToFocus]);

  return (
    <div className="space-y-8">
      <ul className="flex flex-wrap gap-2" aria-label={t('parking.live.legend')}>
        {(['AVAILABLE', 'OCCUPIED', 'BLOCKED'] as const).map((status) => (
          <li key={status}>
            <StatusBadge tone={SLOT_TONE[status]} dot>
              {t(`parking.slotStatus.${status}`)}
            </StatusBadge>
          </li>
        ))}
        {own.size > 0 && (
          <li>
            <StatusBadge tone="info" dot>
              {t('user.layout.yours')}
            </StatusBadge>
          </li>
        )}
      </ul>

      {layout.blocks.map((block) => (
        <section key={block.code} aria-labelledby={`layout-${block.code}`} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3
              id={`layout-${block.code}`}
              className="flex items-center gap-2 text-lg font-semibold"
            >
              <MapPin className="size-5 text-primary" aria-hidden />
              {block.name}
            </h3>
            <BlockMapLink coordinates={block.coordinates} />
          </div>

          {block.zones.map((zone) => {
            const Icon = VEHICLE_ICON[zone.vehicleType];
            const occupied = zone.counts.occupied + zone.counts.held;
            return (
              <div key={zone.code} className="rounded-xl border bg-card p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <h4 className="flex items-center gap-2 font-medium">
                    <Icon className="size-5 text-muted-foreground" aria-hidden />
                    {t(`vehicleTypes.${zone.vehicleType}`)}
                  </h4>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {t('user.layout.zoneCounts', {
                      available: zone.counts.available,
                      occupied,
                      blocked: zone.counts.blocked,
                    })}
                  </p>
                </div>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] gap-2">
                  {zone.slots.map((slot) => {
                    const mine = own.has(slot.code);
                    const focused = slot.code === focus;
                    const status = t(`parking.slotStatus.${slot.status}`);
                    return (
                      <li key={slot.code}>
                        <button
                          ref={focused ? focusRef : undefined}
                          type="button"
                          onClick={() => setSelection({ slot, zone, block })}
                          aria-label={[slot.code, status, mine ? t('user.layout.yours') : null]
                            .filter(Boolean)
                            .join(', ')}
                          aria-current={mine ? 'location' : undefined}
                          className={cn(
                            'flex h-[4.5rem] w-full flex-col justify-between rounded-lg border-2 p-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            mine
                              ? 'border-primary bg-primary text-primary-foreground ring-4 ring-primary/25'
                              : SLOT_TILE[slot.status],
                          )}
                        >
                          <span className="flex items-center justify-between gap-1">
                            <span className="text-sm font-bold" translate="no">
                              {slot.code}
                            </span>
                            {mine && <MapPin className="size-4" aria-hidden />}
                          </span>
                          <span className="truncate text-[0.7rem] font-medium">
                            {mine ? t('user.layout.tileYours') : status}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </section>
      ))}

      <SlotInfoDialog
        selection={selection}
        mine={selection ? own.has(selection.slot.code) : false}
        onClose={() => setSelection(null)}
      />
    </div>
  );
}

function SlotInfoDialog({
  selection,
  mine,
  onClose,
}: {
  selection: Selection | null;
  mine: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const slot = selection?.slot;
  const occupant = mine ? slot?.occupant : null;

  return (
    <Dialog open={selection !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        {selection && slot && (
          <>
            <DialogHeader>
              <DialogTitle translate="no">
                {t('parking.live.slotTitle', { slot: slot.code })}
              </DialogTitle>
              <DialogDescription>
                {selection.block.name} · {t(`vehicleTypes.${selection.zone.vehicleType}`)}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <SlotStatusBadge status={slot.status} />
              {occupant ? (
                <div className="space-y-2 rounded-lg border bg-muted/40 p-4">
                  <p className="font-medium">{t('user.layout.yourVehicle')}</p>
                  <PlateBadge value={occupant.vehicleNumber} />
                  <p className="text-muted-foreground">
                    {t('parking.common.entry')} {formatHour(occupant.entryHour)} ·{' '}
                    {t('parking.common.hours', { count: occupant.currentDurationHours })}
                  </p>
                </div>
              ) : slot.status === 'AVAILABLE' ? (
                <p className="text-muted-foreground">{t('user.layout.slotFree')}</p>
              ) : slot.status === 'BLOCKED' ? (
                <p className="text-muted-foreground">{t('user.layout.slotBlocked')}</p>
              ) : (
                <p className="text-muted-foreground">{t('user.layout.slotTaken')}</p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
