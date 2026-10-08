import type { SlotStatus } from '@cpvts/shared';

import type { StatusTone } from '@/components/feedback/StatusBadge';

/** Semantic colour for each slot state, shared by badges and the map legend. */
export const SLOT_TONE: Record<SlotStatus, StatusTone> = {
  AVAILABLE: 'success',
  OCCUPIED: 'danger',
  BLOCKED: 'neutral',
  HELD: 'warning',
};

/** Tile styles for the resident-facing slot layout (same status colours everywhere). */
export const SLOT_TILE: Record<SlotStatus, string> = {
  AVAILABLE: 'border-success/40 bg-success/10 text-foreground hover:bg-success/15',
  OCCUPIED: 'border-destructive/30 bg-destructive/10 text-foreground hover:bg-destructive/15',
  BLOCKED:
    'border-border text-muted-foreground bg-[repeating-linear-gradient(135deg,var(--muted),var(--muted)_6px,var(--background)_6px,var(--background)_12px)]',
  HELD: 'border-warning/50 bg-warning/10 text-foreground',
};
