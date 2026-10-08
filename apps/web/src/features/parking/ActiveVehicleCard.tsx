import type { ParkingSessionView } from '@cpvts/shared';
import { CircleCheck, LogOut, MapPinned, ReceiptText, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { areaPaths, exitPath } from '@/app/paths';
import { BlockMapLink } from '@/components/parking/BlockMapLink';
import { FeeBreakdownView } from '@/components/parking/FeeBreakdownView';
import { SessionDetails } from '@/components/parking/SessionDetails';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentUser } from '@/features/auth/use-auth';

/** Vehicle Tracking Center result with retrieval actions (Master Blueprint §12–§13). */
export function ActiveVehicleCard({ session }: { session: ParkingSessionView }) {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const paths = areaPaths(user.role);
  const active = session.status === 'ACTIVE';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleCheck className="size-5 text-success" aria-hidden />
          {active ? t('parking.finder.foundTitle') : t('parking.finder.completedTitle')}
        </CardTitle>
        <CardDescription>
          {session.block.name} · {t('parking.common.slot')} {session.slotCode}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <SessionDetails session={session} />
        <div className="space-y-4">
          {active && session.estimatedFee && (
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="mb-1 text-sm font-semibold">{t('parking.common.estimatedFee')}</p>
              <p className="mb-3 text-xs text-muted-foreground">
                {t('parking.common.estimatedFeeHint')}
              </p>
              <FeeBreakdownView fee={session.estimatedFee} />
            </div>
          )}
          <div className="flex flex-col gap-2">
            {active && (
              <Button asChild>
                <Link to={paths.live(session.slotCode)}>
                  <MapPinned aria-hidden />
                  {t('parking.common.locateOnMap')}
                </Link>
              </Button>
            )}
            <BlockMapLink coordinates={session.block.coordinates} size="default" />
            <Button asChild variant="outline">
              <Link to={paths.session(session.sessionNumber)}>
                <ScrollText aria-hidden />
                {t('parking.common.viewSession')}
              </Link>
            </Button>
            {active && user.role === 'SECURITY_STAFF' && (
              <Button asChild variant="secondary">
                <Link to={exitPath(session.sessionNumber)}>
                  <LogOut aria-hidden />
                  {t('parking.common.checkout')}
                </Link>
              </Button>
            )}
            {!active && session.receiptNumber && (
              <Button asChild variant="secondary">
                <Link to={paths.receipt(session.receiptNumber)}>
                  <ReceiptText aria-hidden />
                  {t('parking.common.viewReceipt')}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
