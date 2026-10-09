import type { ParkingSessionView } from '@cpvts/shared';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/feedback/StatusBadge';
import { DescriptionItem, DescriptionList } from '@/components/ui/description-list';

import { SessionTimer } from './SessionTimer';

interface SessionDetailsProps {
  session: ParkingSessionView;
  /** Reload hook for the live estimate (see `SessionTimer`). */
  onStale?: () => void;
}

/**
 * Core facts of a parking session, in the order staff need them: the vehicle and where it is
 * first, then the timer with entry time and fee (live while active, final once completed).
 */
export function SessionDetails({ session, onStale }: SessionDetailsProps) {
  const { t } = useTranslation();
  const active = session.status === 'ACTIVE';

  return (
    <div className="space-y-4">
      <DescriptionList>
        <DescriptionItem label={t('parking.common.vehicleNumber')}>
          <span className="font-mono text-lg font-bold tracking-wide">{session.vehicleNumber}</span>
        </DescriptionItem>
        <DescriptionItem label={t('parking.common.slot')}>
          <span className="text-lg font-bold">{session.slotCode}</span>
          <span className="text-muted-foreground"> · {session.block.name}</span>
        </DescriptionItem>
        <DescriptionItem label={t('parking.common.vehicleType')}>
          {t(`vehicleTypes.${session.vehicleType}`)}
        </DescriptionItem>
        <DescriptionItem label={t('parking.common.ownerCategory')}>
          {t(`ownerCategories.${session.ownerCategory}`)}
        </DescriptionItem>
        <DescriptionItem label={t('parking.common.sessionNumber')}>
          <span className="font-mono">{session.sessionNumber}</span>
        </DescriptionItem>
        <DescriptionItem label={t('parking.common.status')}>
          <StatusBadge tone={active ? 'info' : 'neutral'} dot={active}>
            {t(`parking.sessionStatus.${session.status}`)}
          </StatusBadge>
        </DescriptionItem>
      </DescriptionList>
      <SessionTimer session={session} onStale={onStale} />
    </div>
  );
}
