import type { PublicParkingLocation } from '@cpvts/shared';
import { MapPin, MapPinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ImageSlot } from '@/components/branding/ImageSlot';
import { EmptyState } from '@/components/feedback/EmptyState';
import { BlockMapLink } from '@/components/parking/BlockMapLink';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ImageSlotId } from '@/config/images';

const slotFor = (vehicleTypes: string[]): ImageSlotId =>
  vehicleTypes.length === 1 && vehicleTypes[0] === 'FOUR_WHEELER'
    ? 'fourWheelerBlock'
    : vehicleTypes.length === 1 && vehicleTypes[0] === 'TWO_WHEELER'
      ? 'twoWheelerBlock'
      : 'campus';

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
          <Card className="h-full gap-4 overflow-hidden pt-0">
            <div className="h-36">
              <ImageSlot slot={slotFor(location.vehicleTypes)} />
            </div>
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
              <BlockMapLink coordinates={location.coordinates} />
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
