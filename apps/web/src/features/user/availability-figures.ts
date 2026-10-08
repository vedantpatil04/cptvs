import type { PortalLayoutResponse, VehicleType } from '@cpvts/shared';

import type { AvailabilityFigure } from '@/components/user/AvailabilityStrip';

/** Totals per vehicle type from the layout's own zone counts (the server's numbers). */
export const figuresFromLayout = (layout: PortalLayoutResponse): AvailabilityFigure[] =>
  (['TWO_WHEELER', 'FOUR_WHEELER'] as VehicleType[]).map((vehicleType) => {
    const zones = layout.blocks.flatMap((block) =>
      block.zones.filter((zone) => zone.vehicleType === vehicleType),
    );
    const sum = (pick: (zone: (typeof zones)[number]) => number) =>
      zones.reduce((total, zone) => total + pick(zone), 0);
    return {
      vehicleType,
      available: sum((zone) => zone.counts.available),
      total: sum((zone) => zone.counts.total),
      occupied: sum((zone) => zone.counts.occupied + zone.counts.held),
      blocked: sum((zone) => zone.counts.blocked),
    };
  });
