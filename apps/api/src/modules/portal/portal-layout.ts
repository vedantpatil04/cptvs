import type { ParkingMapResponse, PortalLayoutResponse } from '@cpvts/shared';

/**
 * The live layout for users and visitors: statuses and counts only. Every
 * occupant (vehicle number, session, category) is removed — nobody sees another
 * vehicle — and `mySlots` marks the viewer's own slot(s).
 */
export const toUserLayout = (map: ParkingMapResponse, mySlots: string[]): PortalLayoutResponse => ({
  ...map,
  blocks: map.blocks.map((block) => ({
    ...block,
    zones: block.zones.map((zone) => ({
      ...zone,
      slots: zone.slots.map((slot) => ({ ...slot, occupant: null })),
    })),
  })),
  mySlots,
});
