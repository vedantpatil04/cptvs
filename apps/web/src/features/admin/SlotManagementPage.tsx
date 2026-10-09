import type { ManagedBlock, ManagedLayout, ManagedSlot, ManagedZone } from '@cpvts/shared';
import {
  Archive,
  Ban,
  CircleCheck,
  Edit2,
  Gauge,
  MapPin,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { BlockMapLink } from '@/components/parking/BlockMapLink';
import { SlotStatusBadge } from '@/components/parking/SlotStatusBadge';
import { VisualParkingLayout } from '@/components/parking/VisualParkingLayout';
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

/** Slot management: visual parking layout, block, unblock, priority, enable/disable, add/delete/archive. */
export function SlotManagementPage() {
  const { t } = useTranslation();
  const [includeArchived, setIncludeArchived] = useState(false);
  const fetchLayout = useCallback(
    (signal: AbortSignal) => adminApi.layout(signal, { includeArchived }),
    [includeArchived],
  );
  const query = useApiQuery(fetchLayout);
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={includeArchived ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setIncludeArchived(!includeArchived)}
            >
              <Archive className="size-4" aria-hidden />
              {includeArchived ? 'Hide Archived' : 'Show Archived'}
            </Button>
            <Button variant="outline" onClick={query.reload}>
              <RefreshCw aria-hidden />
              {t('system.refresh')}
            </Button>
          </div>
        }
      />
      <div className="space-y-8">
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
        {query.status === 'success' && (
          <>
            {/* Visual Parking Layout for Admin */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold tracking-tight">Interactive Visual Layout</h2>
              <VisualParkingLayout
                blocks={query.data.blocks}
                adminMode={true}
                onAdminSlotClick={(slot, _zone, _block) => {
                  setNotice(null);
                  setAction({ kind: 'edit', slot: slot as ManagedSlot });
                }}
                onAdminAddSlot={(zone, block) => {
                  setNotice(null);
                  setAction({
                    kind: 'create',
                    zone: zone as ManagedZone,
                    block: block as ManagedBlock,
                  });
                }}
              />
            </div>

            {/* Granular Block & Slot Management Cards with Tables */}
            <div className="space-y-6">
              <h2 className="text-lg font-semibold tracking-tight">Slot Directory & Actions</h2>
              {query.data.blocks.map((block) => (
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
          </>
        )}
      </div>
      <SlotActionDialog action={action} onClose={() => setAction(null)} onDone={onDone} />
    </>
  );
}

function BlockCard({
  block,
  onAction,
}: {
  block: Block;
  onAction: (action: SlotAction) => void;
}) {
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
          <section key={zone.code} aria-labelledby={`zone-${zone.code}`} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`zone-${zone.code}`} className="font-semibold">
                {zone.name}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  · {t(`vehicleTypes.${zone.vehicleType}`)}
                </span>
              </h3>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => onAction({ kind: 'create', zone, block })}
              >
                <Plus className="size-4" aria-hidden />
                Add Slot
              </Button>
            </div>
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
    <div className="overflow-x-auto rounded-md border">
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
          {slots.map((slot) => {
            const isBlocked = slot.status === 'BLOCKED';
            const isAvailable = slot.status === 'AVAILABLE';
            const isArchived = Boolean(slot.archivedAt);

            return (
              <TableRow key={slot.code} className={isArchived ? 'opacity-60 bg-muted/20' : undefined}>
                <TableCell className="font-semibold font-mono">
                  {slot.code}
                  {slot.isEnabled === false && (
                    <span className="ml-2 rounded bg-destructive/10 px-1 py-0.5 text-[10px] text-destructive font-sans font-bold">
                      Disabled
                    </span>
                  )}
                  {isArchived && (
                    <span className="ml-2 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground font-sans">
                      Archived
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <SlotStatusBadge status={slot.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{slot.priority}</TableCell>
                <TableCell className="max-w-56 text-muted-foreground">
                  {slot.blockedReason ?? '—'}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {/* Block / Unblock */}
                    {isBlocked ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onAction({ kind: 'unblock', slot })}
                      >
                        <Unlock className="size-3.5" aria-hidden />
                        {t('slots.unblock')}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!isAvailable}
                        title={!isAvailable ? t('slots.blockOnlyAvailable') : undefined}
                        onClick={() => onAction({ kind: 'block', slot })}
                      >
                        <Ban className="size-3.5" aria-hidden />
                        {t('slots.block')}
                      </Button>
                    )}

                    {/* Priority */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onAction({ kind: 'priority', slot })}
                      title={t('slots.setPriority')}
                    >
                      <Gauge className="size-3.5" aria-hidden />
                      {t('slots.setPriority')}
                    </Button>

                    {/* Edit */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onAction({ kind: 'edit', slot })}
                      title="Edit slot details"
                    >
                      <Edit2 className="size-3.5" aria-hidden />
                    </Button>

                    {/* Enable / Disable */}
                    {slot.isEnabled ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={slot.status === 'OCCUPIED' || slot.status === 'HELD'}
                        onClick={() => onAction({ kind: 'disable', slot })}
                        title="Disable slot (take out of service)"
                      >
                        <Power className="size-3.5 text-amber-600" aria-hidden />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onAction({ kind: 'enable', slot })}
                        title="Enable slot (return to service)"
                      >
                        <Power className="size-3.5 text-emerald-600" aria-hidden />
                      </Button>
                    )}

                    {/* Archive / Restore / Safe Delete */}
                    {isArchived ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onAction({ kind: 'restore', slot })}
                        title="Restore archived slot"
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        Restore
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={slot.status === 'OCCUPIED' || slot.status === 'HELD'}
                        onClick={() => onAction({ kind: 'delete', slot })}
                        title="Safe delete (deletes if unused, archives if has history)"
                      >
                        <Trash2 className="size-3.5 text-destructive" aria-hidden />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
