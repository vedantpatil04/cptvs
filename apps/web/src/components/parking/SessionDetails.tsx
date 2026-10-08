import type { ParkingSessionView } from '@cpvts/shared';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/feedback/StatusBadge';
import { DescriptionItem, DescriptionList } from '@/components/ui/description-list';
import { formatHour } from '@/lib/format';

/** Core facts of a parking session, in the order staff need them. */
export function SessionDetails({ session }: { session: ParkingSessionView }) {
  const { t } = useTranslation();
  const active = session.status === 'ACTIVE';
  const duration = active ? session.currentDurationHours : session.durationHours;

  return (
    <DescriptionList>
      <DescriptionItem label={t('parking.common.vehicleNumber')}>
        <span className="font-mono text-base tracking-wide">{session.vehicleNumber}</span>
      </DescriptionItem>
      <DescriptionItem label={t('parking.common.vehicleType')}>
        {t(`vehicleTypes.${session.vehicleType}`)}
      </DescriptionItem>
      <DescriptionItem label={t('parking.common.ownerCategory')}>
        {t(`ownerCategories.${session.ownerCategory}`)}
      </DescriptionItem>
      <DescriptionItem label={t('parking.common.block')}>{session.block.name}</DescriptionItem>
      <DescriptionItem label={t('parking.common.slot')}>
        <span className="text-lg font-bold">{session.slotCode}</span>
      </DescriptionItem>
      <DescriptionItem label={t('parking.common.sessionNumber')}>
        <span className="font-mono">{session.sessionNumber}</span>
      </DescriptionItem>
      <DescriptionItem label={t('parking.common.entry')}>
        {formatHour(session.entryHour)}
      </DescriptionItem>
      {!active && session.exitHour !== null && (
        <DescriptionItem label={t('parking.common.exit')}>
          {formatHour(session.exitHour)}
        </DescriptionItem>
      )}
      {duration !== null && (
        <DescriptionItem
          label={active ? t('parking.common.currentDuration') : t('parking.common.duration')}
        >
          {t('parking.common.hours', { count: duration })}
        </DescriptionItem>
      )}
      <DescriptionItem label={t('parking.common.status')}>
        <StatusBadge tone={active ? 'info' : 'neutral'} dot={active}>
          {t(`parking.sessionStatus.${session.status}`)}
        </StatusBadge>
      </DescriptionItem>
    </DescriptionList>
  );
}
