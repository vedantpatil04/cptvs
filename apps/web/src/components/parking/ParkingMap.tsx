import type {
  ParkingMapBlock,
  ParkingMapResponse,
  ParkingMapSlot,
  ParkingMapZone,
  SlotStatus,
} from '@cpvts/shared';
import { Bike, Car, MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/feedback/StatusBadge';
import { cn } from '@/lib/utils';

import { BlockMapLink } from './BlockMapLink';
import { SLOT_TONE } from './slot-tone';

const SLOT_STYLES: Record<SlotStatus, string> = {
  AVAILABLE: 'border-success/40 bg-success/10 hover:bg-success/15',
  OCCUPIED: 'border-destructive/40 bg-destructive/10 hover:bg-destructive/15',
  BLOCKED:
    'border-border text-muted-foreground bg-[repeating-linear-gradient(135deg,var(--muted),var(--muted)_6px,var(--background)_6px,var(--background)_12px)]',
  HELD: 'border-warning/50 bg-warning/10',
};

const VEHICLE_ICON = { TWO_WHEELER: Bike, FOUR_WHEELER: Car } as const;

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

/**
 * Logical parking map of the configured layout: block → zone → slots.
 * Google Maps is used only for the block's real-world location, never for
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
      <ul className="flex flex-wrap gap-2" aria-label={t('parking.live.legend')}>
        {(['AVAILABLE', 'OCCUPIED', 'BLOCKED'] as const).map((status) => (
          <li key={status}>
            <StatusBadge tone={SLOT_TONE[status]} dot>
              {t(`parking.slotStatus.${status}`)}
            </StatusBadge>
          </li>
        ))}
      </ul>

      {map.blocks.map((block) => (
        <section key={block.code} aria-labelledby={`block-${block.code}`} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3
              id={`block-${block.code}`}
              className="flex items-center gap-2 text-lg font-semibold"
            >
              <MapPin className="size-5 text-primary" aria-hidden />
              {block.name}
            </h3>
            <BlockMapLink coordinates={block.coordinates} />
          </div>

          {block.zones.map((zone) => {
            const Icon = VEHICLE_ICON[zone.vehicleType];
            return (
              <div key={zone.code} className="rounded-xl border bg-card p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="flex items-center gap-2 font-medium">
                    <Icon className="size-5 text-muted-foreground" aria-hidden />
                    {zone.name}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {t('parking.live.zoneCounts', {
                      available: zone.counts.available,
                      total: zone.counts.total,
                    })}
                  </p>
                </div>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
                  {zone.slots.map((slot) => {
                    const highlighted = slot.code === highlightSlot;
                    const statusLabel = t(`parking.slotStatus.${slot.status}`);
                    return (
                      <li key={slot.code}>
                        <button
                          ref={highlighted ? highlightRef : undefined}
                          type="button"
                          onClick={() => onSelect({ slot, zone, block })}
                          aria-label={[slot.code, statusLabel, slot.occupant?.vehicleNumber]
                            .filter(Boolean)
                            .join(', ')}
                          aria-current={highlighted ? 'location' : undefined}
                          className={cn(
                            'flex h-20 w-full flex-col justify-between rounded-lg border-2 p-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            SLOT_STYLES[slot.status],
                            highlighted &&
                              'ring-4 ring-primary ring-offset-2 ring-offset-background',
                          )}
                        >
                          <span className="flex items-center justify-between gap-1">
                            <span className="text-sm font-bold">{slot.code}</span>
                            {highlighted && <MapPin className="size-4 text-primary" aria-hidden />}
                          </span>
                          <span className="truncate font-mono text-xs">
                            {slot.occupant?.vehicleNumber ?? statusLabel}
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
    </div>
  );
}
