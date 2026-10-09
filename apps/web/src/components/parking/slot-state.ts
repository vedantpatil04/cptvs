import type { SlotStatus } from '@cpvts/shared';
import { Ban, Car, CircleCheck, Hourglass, PowerOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Everything a slot can look like: the four backend states, plus "disabled by an admin". */
export type SlotTileState = SlotStatus | 'DISABLED';

interface StateStyle {
  icon: LucideIcon;
  /** Tile surface: tinted background + coloured border. */
  tile: string;
  /** Status label colour (always readable on the tile). */
  text: string;
  /** Legend / count swatch. */
  swatch: string;
}

/**
 * Colour is never the only signal: every state also has its own icon and a text label.
 * Available = green, Held = amber, Occupied = red, Blocked = grey hatch, Disabled = dashed grey.
 */
export const SLOT_STATE_STYLE: Record<SlotTileState, StateStyle> = {
  AVAILABLE: {
    icon: CircleCheck,
    tile: 'border-success/60 bg-success/10 hover:bg-success/15',
    text: 'text-success',
    swatch: 'border-success bg-success/20',
  },
  HELD: {
    icon: Hourglass,
    tile: 'border-warning/70 bg-warning/10 hover:bg-warning/15',
    text: 'text-warning',
    swatch: 'border-warning bg-warning/20',
  },
  OCCUPIED: {
    icon: Car,
    tile: 'border-destructive/60 bg-destructive/10 hover:bg-destructive/15',
    text: 'text-destructive',
    swatch: 'border-destructive bg-destructive/20',
  },
  BLOCKED: {
    icon: Ban,
    tile: 'border-muted-foreground/50 bg-[repeating-linear-gradient(135deg,var(--muted),var(--muted)_6px,var(--card)_6px,var(--card)_12px)] hover:bg-muted',
    text: 'text-muted-foreground',
    swatch: 'border-muted-foreground bg-muted',
  },
  DISABLED: {
    icon: PowerOff,
    tile: 'border-dashed border-muted-foreground/40 bg-muted/40 opacity-70 hover:bg-muted/60',
    text: 'text-muted-foreground',
    swatch: 'border-dashed border-muted-foreground bg-transparent',
  },
};

export interface SlotCountValues {
  total: number;
  available: number;
  held: number;
  occupied: number;
  blocked: number;
  disabled: number;
}

/** Counts for a list of slots, derived from the same states the tiles show. */
export const countSlotStates = (states: SlotTileState[]): SlotCountValues => {
  const counts: SlotCountValues = {
    total: states.length,
    available: 0,
    held: 0,
    occupied: 0,
    blocked: 0,
    disabled: 0,
  };
  for (const state of states) {
    counts[state.toLowerCase() as keyof Omit<SlotCountValues, 'total'>] += 1;
  }
  return counts;
};
