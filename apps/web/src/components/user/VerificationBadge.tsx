import type { VerificationStatus } from '@cpvts/shared';
import { BadgeCheck, Clock, CircleX, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatusBadge, type StatusTone } from '@/components/feedback/StatusBadge';

const TONE: Record<VerificationStatus, StatusTone> = {
  PENDING: 'warning',
  VERIFIED: 'success',
  REJECTED: 'danger',
};

const ICON: Record<VerificationStatus, LucideIcon> = {
  PENDING: Clock,
  VERIFIED: BadgeCheck,
  REJECTED: CircleX,
};

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const { t } = useTranslation();
  const Icon = ICON[status];
  return (
    <StatusBadge tone={TONE[status]}>
      <Icon aria-hidden />
      {t(`verification.status.${status}`)}
    </StatusBadge>
  );
}
