import type { ParkingMapResponse, PortalLayoutResponse } from '@cpvts/shared';

/**
 * The live layout for users and visitors: statuses and counts only. Every
 * occupant (vehicle number, session, category) is removed — nobody sees another
 * vehicle — and `mySlots` marks the viewer's own slot(s).
 */
export const toUserLayout = (map: ParkingMapResponse, mySlots: string[]): PortalLayoutResponse => ({
  ...map,
  blocks: map.blocks.map((block: ParkingMapResponse['blocks'][number]) => ({
    ...block,
    zones: block.zones.map((zone: ParkingMapResponse['blocks'][number]['zones'][number]) => ({
      ...zone,
      slots: zone.slots.map(
        (slot: ParkingMapResponse['blocks'][number]['zones'][number]['slots'][number]) => ({
          ...slot,
          occupant: null,
        }),
      ),
    })),
  })),
  mySlots,
});
