import type { VehicleType } from '@cpvts/shared';
import { Bike, Car, MapPin } from 'lucide-react';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { SLOT_STATE_STYLE, type SlotCountValues, type SlotTileState } from './slot-state';

const VEHICLE_ICON = { TWO_WHEELER: Bike, FOUR_WHEELER: Car } as const;

export interface SlotTileProps {
  code: string;
  state: SlotTileState;
  vehicleType: VehicleType;
  /** Plate of the parked vehicle (occupied slots). */
  vehicleNumber?: string | null;
  /** Extra line: block reason, "archived", priority … */
  note?: string | null;
  /** This is the signed-in driver's own slot. */
  mine?: boolean;
  /** Highlighted from a search or link. */
  highlighted?: boolean;
  onClick?: () => void;
}

/**
 * One parking slot: big ID (T-01 / F-01), vehicle-type icon, a text + icon status, and the
 * parked plate. At least 6 rem tall so it is an easy touch target.
 */
export const SlotTile = forwardRef<HTMLButtonElement, SlotTileProps>(function SlotTile(
  { code, state, vehicleType, vehicleNumber, note, mine = false, highlighted = false, onClick },
  ref,
) {
  const { t } = useTranslation();
  const style = SLOT_STATE_STYLE[state];
  const StateIcon = style.icon;
  const TypeIcon = VEHICLE_ICON[vehicleType];
  const label = t(`parking.slotStatus.${state}`);
  const detail = mine ? t('parking.slotTile.yourVehicle') : (vehicleNumber ?? note ?? null);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={[code, t(`vehicleTypes.${vehicleType}`), label, vehicleNumber, note]
        .filter(Boolean)
        .join(', ')}
      aria-current={highlighted || mine ? 'location' : undefined}
      className={cn(
        'relative flex min-h-[6.25rem] w-full flex-col justify-between gap-1 rounded-xl border-2 p-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60',
        style.tile,
        mine && 'border-primary bg-primary/15 ring-4 ring-primary/40',
        highlighted && !mine && 'ring-4 ring-info/50',
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="font-mono text-xl leading-none font-extrabold tracking-tight">{code}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {(mine || highlighted) && <MapPin className="size-4 text-primary" aria-hidden />}
          <TypeIcon className="size-4" aria-hidden />
        </span>
      </span>
      <span className={cn('flex items-center gap-1.5 text-sm font-semibold', style.text)}>
        <StateIcon className="size-4 shrink-0" aria-hidden />
        {label}
      </span>
      <span className="min-h-4 truncate font-mono text-xs text-foreground/80">{detail ?? ' '}</span>
    </button>
  );
});

const COUNT_ORDER: SlotTileState[] = [
  'AVAILABLE',
  'HELD',
  'OCCUPIED',
  'RESERVED',
  'BLOCKED',
  'DISABLED',
];

/** "Available 4 · Held 0 · Occupied 5 · Blocked 1" with the same swatches as the tiles. */
export function SlotCountChips({
  counts,
  className,
}: {
  counts: SlotCountValues;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm', className)}>
      {COUNT_ORDER.map((state) => {
        const value = counts[state.toLowerCase() as keyof SlotCountValues];
        if ((state === 'DISABLED' || state === 'RESERVED') && value === 0) return null;
        return (
          <li key={state} className="flex items-center gap-1.5">
            <span
              className={cn('size-3.5 rounded-sm border-2', SLOT_STATE_STYLE[state].swatch)}
              aria-hidden
            />
            <span className="text-muted-foreground">{t(`parking.slotStatus.${state}`)}</span>
            <span className="font-bold tabular-nums">{value}</span>
          </li>
        );
      })}
      <li className="flex items-center gap-1.5 border-l pl-4">
        <span className="text-muted-foreground">{t('parking.slotTile.total')}</span>
        <span className="font-bold tabular-nums">{counts.total}</span>
      </li>
    </ul>
  );
}
