import type { CheckInResponse } from '@cpvts/shared';
import { BadgeCheck, CircleCheck, MapPinned, Plus, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { areaPaths } from '@/app/paths';
import { QrCode } from '@/components/parking/QrCode';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DescriptionItem, DescriptionList } from '@/components/ui/description-list';
import { useCurrentUser } from '@/features/auth/use-auth';
import { formatHour } from '@/lib/format';
import { entryQrPayload } from '@cpvts/shared';

/** Successful check-in: assigned slot, the reasons for the choice and the entry QR. */
export function AllocationResult({
  result,
  onNext,
}: {
  result: CheckInResponse;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const paths = areaPaths(user.role);
  const { session, allocation } = result;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Card className="border-success/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-success">
            <CircleCheck className="size-5" aria-hidden />
            {t('parking.entry.successTitle')}
          </CardTitle>
          <CardDescription>{session.block.name}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <p className="text-sm text-muted-foreground">{t('parking.entry.assignedSlot')}</p>
              <p className="text-5xl font-bold tracking-tight" aria-live="polite">
                {session.slotCode}
              </p>
            </div>
            <div className="pb-1">
              <p className="font-mono text-lg">{session.vehicleNumber}</p>
              <p className="text-sm text-muted-foreground">
                {t(`vehicleTypes.${session.vehicleType}`)} ·{' '}
                {t(`ownerCategories.${session.ownerCategory}`)} · {formatHour(session.entryHour)}
              </p>
            </div>
          </div>

          {result.categorySource === 'ACCOUNT' && (
            <Alert variant="info">
              <BadgeCheck aria-hidden />
              <AlertDescription>
                {t('parking.entry.categoryFromAccount', {
                  category: t(`ownerCategories.${session.ownerCategory}`),
                })}
              </AlertDescription>
            </Alert>
          )}

          <section aria-labelledby="allocation-title" className="rounded-lg bg-muted/60 p-4">
            <h3
              id="allocation-title"
              className="mb-3 text-sm font-semibold tracking-wide uppercase"
            >
              {t('parking.allocation.title')}
            </h3>
            <ul className="space-y-1.5 text-sm">
              {allocation.checks.map((check) => (
                <li key={check} className="flex items-center gap-2">
                  <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
                  {t(`parking.allocation.checks.${check}`, { score: allocation.score })}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              {t('parking.allocation.candidates', { count: allocation.candidatesConsidered })}
              {allocation.fallbacks > 0 &&
                ` · ${t('parking.allocation.fallbacks', { count: allocation.fallbacks })}`}
            </p>
          </section>

          <DescriptionList>
            <DescriptionItem label={t('parking.common.sessionNumber')}>
              <span className="font-mono">{session.sessionNumber}</span>
            </DescriptionItem>
            <DescriptionItem label={t('parking.common.zone')}>{session.zone.name}</DescriptionItem>
          </DescriptionList>

          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to={paths.live(session.slotCode)}>
                <MapPinned aria-hidden />
                {t('parking.common.locateOnMap')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={paths.session(session.sessionNumber)}>
                <ScrollText aria-hidden />
                {t('parking.common.viewSession')}
              </Link>
            </Button>
            <Button variant="outline" onClick={onNext}>
              <Plus aria-hidden />
              {t('parking.entry.checkInAnother')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {session.entryReference && (
        <Card className="items-center text-center">
          <CardHeader className="w-full">
            <CardTitle>{t('parking.entry.entryQrTitle')}</CardTitle>
            <CardDescription>{t('parking.entry.entryQrHint')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2">
            <QrCode
              value={entryQrPayload(session.entryReference)}
              label={t('parking.entry.entryQrTitle')}
            />
            <p className="font-mono text-sm">{session.sessionNumber}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
