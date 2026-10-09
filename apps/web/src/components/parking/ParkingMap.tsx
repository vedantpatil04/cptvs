import type {
  ParkingMapBlock,
  ParkingMapResponse,
  ParkingMapSlot,
  ParkingMapZone,
} from '@cpvts/shared';
import { Bike, Car, MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { BlockMapLink } from './BlockMapLink';
import { SLOT_STATE_STYLE, type SlotCountValues, type SlotTileState } from './slot-state';
import { SlotCountChips, SlotTile } from './SlotTile';

const VEHICLE_ICON = { TWO_WHEELER: Bike, FOUR_WHEELER: Car } as const;
const LEGEND: SlotTileState[] = ['AVAILABLE', 'HELD', 'OCCUPIED', 'RESERVED', 'BLOCKED'];

export interface SelectedSlot {
  slot: ParkingMapSlot;
  zone: ParkingMapZone;
  block: ParkingMapBlock;
}

interface ParkingMapProps {
  map: ParkingMapResponse;
  /** Slot to highlight (e.g. the result of a vehicle search). */
  highlightSlot?: string | null;
  onSelect: (selection: SelectedSlot) => void;
}

/** The server's per-zone counts, in the shape the count chips draw. */
const countsOf = (zone: ParkingMapZone): SlotCountValues => ({
  ...zone.counts,
  reserved: zone.counts.reserved ?? 0,
  disabled: 0,
});

const sum = (zones: ParkingMapZone[]): SlotCountValues =>
  zones.reduce<SlotCountValues>(
    (total, zone) => ({
      total: total.total + zone.counts.total,
      available: total.available + zone.counts.available,
      held: total.held + zone.counts.held,
      reserved: total.reserved + (zone.counts.reserved ?? 0),
      occupied: total.occupied + zone.counts.occupied,
      blocked: total.blocked + zone.counts.blocked,
      disabled: 0,
    }),
    { total: 0, available: 0, held: 0, reserved: 0, occupied: 0, blocked: 0, disabled: 0 },
  );

/**
 * Logical parking map of the configured layout: block → zone → slots. Availability and counts
 * come from the server. Google Maps is used only for the block's real-world location, never for
 * individual adjacent slots (Master Blueprint §7).
 */
export function ParkingMap({ map, highlightSlot, onSelect }: ParkingMapProps) {
  const { t } = useTranslation();
  const highlightRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightSlot]);

  return (
    <div className="space-y-6">
      <ul
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm"
        aria-label={t('parking.live.legend')}
      >
        {LEGEND.map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <span
              className={cn('size-4 rounded-sm border-2', SLOT_STATE_STYLE[state].swatch)}
              aria-hidden
            />
            {t(`parking.slotStatus.${state}`)}
          </li>
        ))}
      </ul>

      {map.blocks.map((block) => (
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
              <SlotCountChips counts={sum(block.zones)} />
            </div>
            <BlockMapLink coordinates={block.coordinates} />
          </div>

          {block.zones.map((zone) => {
            const Icon = VEHICLE_ICON[zone.vehicleType];
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
                  <span className="text-sm font-medium">
                    {t('parking.live.zoneCounts', {
                      available: zone.counts.available,
                      total: zone.counts.total,
                    })}
                  </span>
                </div>
                <SlotCountChips counts={countsOf(zone)} className="mb-3" />
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
                  {zone.slots.map((slot) => {
                    const highlighted = slot.code === highlightSlot;
                    return (
                      <li key={slot.code}>
                        <SlotTile
                          ref={highlighted ? highlightRef : undefined}
                          code={slot.code}
                          state={slot.status}
                          vehicleType={zone.vehicleType}
                          vehicleNumber={slot.occupant?.vehicleNumber}
                          note={slot.status === 'BLOCKED' ? slot.blockedReason : null}
                          highlighted={highlighted}
                          onClick={() => onSelect({ slot, zone, block })}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
