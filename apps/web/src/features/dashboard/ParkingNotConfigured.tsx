import { SquareParking } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback/EmptyState';

/** Shown until the parking modules are delivered; no placeholder data is displayed. */
export function ParkingNotConfigured() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={SquareParking}
      title={t('dashboard.parkingEmptyTitle')}
      description={t('dashboard.parkingEmptyDescription')}
    />
  );
}
