import type { SlotStatus } from '@cpvts/shared';

import type { StatusTone } from '@/components/feedback/StatusBadge';

/** Semantic colour for each slot state, shared by badges and the map legend. */
export const SLOT_TONE: Record<SlotStatus, StatusTone> = {
  AVAILABLE: 'success',
  OCCUPIED: 'danger',
  BLOCKED: 'neutral',
  HELD: 'warning',
};
