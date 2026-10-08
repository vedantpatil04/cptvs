import type { PublicParkingLocation } from '@cpvts/shared';
import { ExternalLink, MapPin, MapPinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback/EmptyState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { googleMapsUrl } from '@/lib/maps';

/** Parking blocks and their real-world location (block level only, never slots). */
export function ParkingLocations({ locations }: { locations: PublicParkingLocation[] }) {
  const { t } = useTranslation();

  if (locations.length === 0) {
    return <EmptyState icon={MapPinOff} title={t('public.locations.empty')} />;
  }

  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {locations.map((location) => (
        <li key={location.code}>
          <Card className="h-full gap-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="size-5 text-primary" aria-hidden />
                {location.name}
              </CardTitle>
              {location.description && <CardDescription>{location.description}</CardDescription>}
            </CardHeader>
            <CardContent className="mt-auto space-y-4">
              {location.vehicleTypes.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t('public.locations.accepts')}:</span>
                  {location.vehicleTypes.map((vehicleType) => (
                    <StatusBadge key={vehicleType} tone="info">
                      {t(`vehicleTypes.${vehicleType}`)}
                    </StatusBadge>
                  ))}
                </div>
              )}
              {location.coordinates ? (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={googleMapsUrl(location.coordinates)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink aria-hidden />
                    {t('public.locations.openInMaps')}
                  </a>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  <MapPinOff aria-hidden />
                  {t('public.locations.mapPending')}
                </Button>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
