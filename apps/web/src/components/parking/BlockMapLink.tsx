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
  inverse = false,
  label,
}: {
  coordinates: Coordinates | null;
  size?: 'sm' | 'default';
  /** Style for the dark brand surface. */
  inverse?: boolean;
  /** Replaces the default "Open in Google Maps" text. */
  label?: string;
}) {
  const { t } = useTranslation();
  const variant = inverse ? 'inverseOutline' : 'outline';
  return coordinates ? (
    <Button asChild variant={variant} size={size}>
      <a href={googleMapsUrl(coordinates)} target="_blank" rel="noopener noreferrer">
        <ExternalLink aria-hidden />
        {label ?? t('public.locations.openInMaps')}
      </a>
    </Button>
  ) : (
    <Button variant={variant} size={size} disabled>
      <MapPinOff aria-hidden />
      {t('public.locations.mapPending')}
    </Button>
  );
}
