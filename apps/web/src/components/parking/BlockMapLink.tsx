import type { Coordinates } from '@cpvts/shared';
import { ExternalLink, MapPinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { googleMapsUrl } from '@/lib/maps';

/**
 * "Open in Google Maps" for a parking block when real coordinates are
 * configured; otherwise a disabled, explanatory placeholder. Never invents a location.
 */
export function BlockMapLink({
  coordinates,
  size = 'sm',
}: {
  coordinates: Coordinates | null;
  size?: 'sm' | 'default';
}) {
  const { t } = useTranslation();
  return coordinates ? (
    <Button asChild variant="outline" size={size}>
      <a href={googleMapsUrl(coordinates)} target="_blank" rel="noopener noreferrer">
        <ExternalLink aria-hidden />
        {t('public.locations.openInMaps')}
      </a>
    </Button>
  ) : (
    <Button variant="outline" size={size} disabled>
      <MapPinOff aria-hidden />
      {t('public.locations.mapPending')}
    </Button>
  );
}
