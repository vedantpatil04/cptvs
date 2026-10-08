import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { areaPaths, exitPath } from '@/app/paths';
import { Button } from '@/components/ui/button';
import { DescriptionItem, DescriptionList } from '@/components/ui/description-list';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCurrentUser } from '@/features/auth/use-auth';
import { formatHour } from '@/lib/format';

import type { SelectedSlot } from './ParkingMap';
import { SlotStatusBadge } from './SlotStatusBadge';

export function SlotDetailsDialog({
  selection,
  onClose,
}: {
  selection: SelectedSlot | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const paths = areaPaths(user.role);
  const occupant = selection?.slot.occupant;

  return (
    <Dialog open={selection !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        {selection && (
          <>
            <DialogHeader>
              <DialogTitle>
                {t('parking.live.slotTitle', { slot: selection.slot.code })}
              </DialogTitle>
              <DialogDescription>
                {selection.block.name} · {selection.zone.name}
              </DialogDescription>
            </DialogHeader>
            <DescriptionList>
              <DescriptionItem label={t('parking.common.status')}>
                <SlotStatusBadge status={selection.slot.status} />
              </DescriptionItem>
              {selection.slot.blockedReason && (
                <DescriptionItem label={t('parking.live.blockedReason')}>
                  {selection.slot.blockedReason}
                </DescriptionItem>
              )}
              {occupant ? (
                <>
                  <DescriptionItem label={t('parking.common.vehicleNumber')}>
                    <span className="font-mono">{occupant.vehicleNumber}</span>
                  </DescriptionItem>
                  <DescriptionItem label={t('parking.common.vehicleType')}>
                    {t(`vehicleTypes.${occupant.vehicleType}`)}
                  </DescriptionItem>
                  <DescriptionItem label={t('parking.common.ownerCategory')}>
                    {t(`ownerCategories.${occupant.ownerCategory}`)}
                  </DescriptionItem>
                  <DescriptionItem label={t('parking.common.entry')}>
                    {formatHour(occupant.entryHour)}
                  </DescriptionItem>
                  <DescriptionItem label={t('parking.common.currentDuration')}>
                    {t('parking.common.hours', { count: occupant.currentDurationHours })}
                  </DescriptionItem>
                  <DescriptionItem label={t('parking.common.sessionNumber')}>
                    <span className="font-mono">{occupant.sessionNumber}</span>
                  </DescriptionItem>
                </>
              ) : (
                selection.slot.status === 'AVAILABLE' && (
                  <p className="pt-3 text-sm text-muted-foreground">
                    {t('parking.live.emptySlot')}
                  </p>
                )
              )}
            </DescriptionList>
            {occupant && (
              <DialogFooter>
                <Button asChild variant="outline">
                  <Link to={paths.session(occupant.sessionNumber)}>
                    {t('parking.common.viewSession')}
                  </Link>
                </Button>
                {user.role === 'SECURITY_STAFF' && (
                  <Button asChild>
                    <Link to={exitPath(occupant.sessionNumber)}>
                      {t('parking.common.checkout')}
                    </Link>
                  </Button>
                )}
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
