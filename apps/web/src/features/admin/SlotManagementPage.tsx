import type { ManagedLayout, ManagedSlot } from '@cpvts/shared';
import { Ban, CircleCheck, Gauge, MapPin, RefreshCw, Unlock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { BlockMapLink } from '@/components/parking/BlockMapLink';
import { SlotStatusBadge } from '@/components/parking/SlotStatusBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';

import { adminApi } from './admin-api';
import { SlotActionDialog, type SlotAction } from './SlotActionDialog';

type Block = ManagedLayout['blocks'][number];

/** Slot management (Master Blueprint §23): block, unblock, priority and block location. */
export function SlotManagementPage() {
  const { t } = useTranslation();
  const query = useApiQuery(adminApi.layout);
  const [action, setAction] = useState<SlotAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onDone = (message: string) => {
    setAction(null);
    setNotice(message);
    query.reload();
  };

  return (
    <>
      <PageHeader
        title={t('slots.title')}
        description={t('slots.description')}
        actions={
          <Button variant="outline" onClick={query.reload}>
            <RefreshCw aria-hidden />
            {t('system.refresh')}
          </Button>
        }
      />
      <div className="space-y-6">
        <div aria-live="polite">
          {notice && (
            <Alert variant="success">
              <CircleCheck aria-hidden />
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
        </div>
        {query.status === 'loading' && <LoadingState />}
        {query.status === 'error' && (
          <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
        )}
        {query.status === 'success' &&
          query.data.blocks.map((block) => (
            <BlockCard
              key={block.code}
              block={block}
              onAction={(next) => {
                setNotice(null);
                setAction(next);
              }}
            />
          ))}
      </div>
      <SlotActionDialog action={action} onClose={() => setAction(null)} onDone={onDone} />
    </>
  );
}

function BlockCard({ block, onAction }: { block: Block; onAction: (action: SlotAction) => void }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{block.name}</CardTitle>
          <CardDescription>
            {[
              block.description,
              block.coordinates
                ? `${block.coordinates.latitude}, ${block.coordinates.longitude}`
                : t('slots.noLocation'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <BlockMapLink coordinates={block.coordinates} />
          <Button variant="outline" size="sm" onClick={() => onAction({ kind: 'location', block })}>
            <MapPin aria-hidden />
            {t('slots.editLocation')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {block.zones.map((zone) => (
          <section key={zone.code} aria-labelledby={`zone-${zone.code}`} className="space-y-2">
            <h3 id={`zone-${zone.code}`} className="font-semibold">
              {zone.name}{' '}
              <span className="text-sm font-normal text-muted-foreground">
                · {t(`vehicleTypes.${zone.vehicleType}`)}
              </span>
            </h3>
            <SlotTable slots={zone.slots} onAction={onAction} />
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function SlotTable({
  slots,
  onAction,
}: {
  slots: ManagedSlot[];
  onAction: (action: SlotAction) => void;
}) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('parking.common.slot')}</TableHead>
          <TableHead>{t('parking.common.status')}</TableHead>
          <TableHead className="text-right">{t('slots.priority')}</TableHead>
          <TableHead>{t('slots.blockedReason')}</TableHead>
          <TableHead className="text-right">{t('slots.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {slots.map((slot) => (
          <TableRow key={slot.code}>
            <TableCell className="font-semibold">{slot.code}</TableCell>
            <TableCell>
              <SlotStatusBadge status={slot.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{slot.priority}</TableCell>
            <TableCell className="max-w-56 text-muted-foreground">
              {slot.blockedReason ?? '—'}
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                {slot.status === 'BLOCKED' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onAction({ kind: 'unblock', slot })}
                  >
                    <Unlock aria-hidden />
                    {t('slots.unblock')}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={slot.status !== 'AVAILABLE'}
                    title={slot.status !== 'AVAILABLE' ? t('slots.blockOnlyAvailable') : undefined}
                    onClick={() => onAction({ kind: 'block', slot })}
                  >
                    <Ban aria-hidden />
                    {t('slots.block')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onAction({ kind: 'priority', slot })}
                >
                  <Gauge aria-hidden />
                  {t('slots.setPriority')}
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
