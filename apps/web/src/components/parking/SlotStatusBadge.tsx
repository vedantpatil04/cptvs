import type { SlotStatus } from '@cpvts/shared';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/feedback/StatusBadge';

import { SLOT_TONE } from './slot-tone';

export function SlotStatusBadge({ status }: { status: SlotStatus }) {
  const { t } = useTranslation();
  return (
    <StatusBadge tone={SLOT_TONE[status]} dot>
      {t(`parking.slotStatus.${status}`)}
    </StatusBadge>
  );
}
