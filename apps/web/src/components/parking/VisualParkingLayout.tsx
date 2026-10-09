import type {
  Coordinates,
  ParkingMapOccupant,
  SlotStatus,
  VehicleType,
} from '@cpvts/shared';
import {
  Bike,
  Car,
  Info,
  Lock,
  MapPin,
  Plus,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/feedback/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { BlockMapLink } from './BlockMapLink';
import { SLOT_TONE } from './slot-tone';

export interface VisualSlotItem {
  code: string;
  status: SlotStatus;
  blockedReason?: string | null;
  occupant?: ParkingMapOccupant | null;
  priority?: number;
  isEnabled?: boolean;
  archivedAt?: string | null;
  hasHistory?: boolean;
  holdExpiresAt?: string | null;
}

export interface VisualZoneItem {
  code: string;
  name: string;
  vehicleType: VehicleType;
  counts?: { total: number; available: number; occupied: number; blocked: number; held?: number };
  slots: VisualSlotItem[];
}

export interface VisualBlockItem {
  code: string;
  name: string;
  description?: string | null;
  coordinates?: Coordinates | null;
  zones: VisualZoneItem[];
}

export interface VisualParkingLayoutProps {
  blocks: VisualBlockItem[];
  userSlotCodes?: string[];
  highlightSlot?: string | null;
  onSelectSlot?: (slot: VisualSlotItem, zone: VisualZoneItem, block: VisualBlockItem) => void;
  adminMode?: boolean;
  onAdminSlotClick?: (slot: VisualSlotItem, zone: VisualZoneItem, block: VisualBlockItem) => void;
  onAdminAddSlot?: (zone: VisualZoneItem, block: VisualBlockItem) => void;
  informationalClick?: boolean;
}

export function VisualParkingLayout({
  blocks,
  userSlotCodes = [],
  highlightSlot,
  onSelectSlot,
  adminMode = false,
  onAdminSlotClick,
  onAdminAddSlot,
  informationalClick = true,
}: VisualParkingLayoutProps) {
  const { t } = useTranslation();
  const highlightRef = useRef<HTMLButtonElement | null>(null);
  const [infoDialogSlot, setInfoDialogSlot] = useState<{
    slot: VisualSlotItem;
    zone: VisualZoneItem;
    block: VisualBlockItem;
  } | null>(null);

  useEffect(() => {
    if (highlightSlot && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightSlot]);

  const handleSlotClick = (
    slot: VisualSlotItem,
    zone: VisualZoneItem,
    block: VisualBlockItem,
  ) => {
    if (adminMode && onAdminSlotClick) {
      onAdminSlotClick(slot, zone, block);
      return;
    }

    if (onSelectSlot) {
      onSelectSlot(slot, zone, block);
    }

    if (!adminMode && informationalClick) {
      setInfoDialogSlot({ slot, zone, block });
    }
  };

  return (
    <div className="space-y-8">
      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/60 p-3 sm:p-4 text-xs">
        <span className="font-semibold text-muted-foreground uppercase tracking-wider">
          {t('parking.live.legend')}:
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border-2 border-emerald-500 bg-emerald-500/20" />
            <span>{t('parking.slotStatus.AVAILABLE')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border-2 border-rose-500 bg-rose-500/20" />
            <span>{t('parking.slotStatus.OCCUPIED')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border-2 border-amber-500 bg-amber-500/20" />
            <span>{t('parking.slotStatus.BLOCKED')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border-2 border-yellow-400 bg-yellow-400/20 animate-pulse" />
            <span>{t('parking.slotStatus.HELD')}</span>
          </div>
          {userSlotCodes.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="size-3 rounded-sm border-2 border-primary bg-primary/30 ring-2 ring-primary ring-offset-1" />
              <span className="font-semibold text-primary">Your Space</span>
            </div>
          )}
        </div>
      </div>

      {blocks.map((block) => (
        <section
          key={block.code}
          aria-labelledby={`block-${block.code}`}
          className="space-y-5 rounded-2xl border bg-card p-4 shadow-xs sm:p-6"
        >
          {/* Block Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <div>
              <h3
                id={`block-${block.code}`}
                className="flex items-center gap-2 text-xl font-bold tracking-tight"
              >
                <MapPin className="size-5 text-primary" aria-hidden />
                {block.name}
              </h3>
              {block.description && (
                <p className="text-sm text-muted-foreground">{block.description}</p>
              )}
            </div>
            <BlockMapLink coordinates={block.coordinates ?? null} />
          </div>

          {/* Zones */}
          <div className="space-y-6">
            {block.zones.map((zone) => {
              const Icon = zone.vehicleType === 'TWO_WHEELER' ? Bike : Car;
              const totalSlots = zone.slots.length;
              const availableSlots = zone.slots.filter(
                (s) => s.status === 'AVAILABLE' && s.isEnabled !== false,
              ).length;

              return (
                <div
                  key={zone.code}
                  className="overflow-hidden rounded-xl border border-border/80 bg-muted/20"
                >
                  {/* Zone Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-background shadow-xs">
                        <Icon className="size-4 text-primary" aria-hidden />
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm leading-tight">{zone.name}</h4>
                        <span className="text-xs text-muted-foreground">
                          {t(`vehicleTypes.${zone.vehicleType}`)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-2xs">
                        {availableSlots} / {totalSlots} available
                      </span>
                      {adminMode && onAdminAddSlot && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => onAdminAddSlot(zone, block)}
                        >
                          <Plus className="size-3.5" />
                          Add Slot
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Realistic Asphalt Bay Yard */}
                  <div className="p-4 sm:p-5">
                    {/* Upper Drive Lane Marking */}
                    <div className="mb-4 flex items-center justify-center border-b-2 border-dashed border-muted-foreground/30 pb-2">
                      <span className="text-[10px] font-mono tracking-widest text-muted-foreground/60 uppercase">
                        ◄ DRIVE AISLE · ONE WAY ►
                      </span>
                    </div>

                    {/* Slots Grid */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                      {zone.slots.map((slot) => {
                        const isUserSlot = userSlotCodes.includes(slot.code);
                        const isHighlighted = slot.code === highlightSlot;
                        const isAvailable = slot.status === 'AVAILABLE';
                        const isOccupied = slot.status === 'OCCUPIED';
                        const isBlocked = slot.status === 'BLOCKED';
                        const isHeld = slot.status === 'HELD';
                        const isDisabled = slot.isEnabled === false;
                        const isArchived = Boolean(slot.archivedAt);

                        return (
                          <div key={slot.code} className="relative group">
                            {/* Parking Bay Container */}
                            <button
                              ref={isHighlighted ? highlightRef : undefined}
                              type="button"
                              onClick={() => handleSlotClick(slot, zone, block)}
                              aria-label={`Slot ${slot.code}, ${slot.status}`}
                              className={cn(
                                'relative flex h-28 w-full flex-col justify-between overflow-hidden rounded-md border-x-4 border-t-2 border-b-4 p-2 text-left transition-all outline-none',
                                'bg-card/90 shadow-2xs hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary',
                                // Status border and background styling
                                isAvailable &&
                                  'border-x-emerald-500/70 border-t-emerald-500/40 border-b-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/15',
                                isOccupied &&
                                  'border-x-rose-500/70 border-t-rose-500/40 border-b-rose-600 bg-rose-500/10 hover:bg-rose-500/15',
                                isBlocked &&
                                  'border-x-amber-500/70 border-t-amber-500/40 border-b-amber-600 bg-[repeating-linear-gradient(135deg,rgba(245,158,11,0.08),rgba(245,158,11,0.08)_8px,transparent_8px,transparent_16px)]',
                                isHeld &&
                                  'border-x-amber-400 border-t-amber-400/60 border-b-amber-500 bg-amber-400/15 animate-pulse',
                                isDisabled && 'opacity-50 grayscale',
                                isArchived && 'opacity-40 border-dashed',
                                // User or Highlighted Slot
                                isUserSlot &&
                                  'ring-4 ring-primary ring-offset-2 border-primary bg-primary/15 shadow-lg scale-102 z-10',
                                isHighlighted &&
                                  !isUserSlot &&
                                  'ring-4 ring-sky-500 ring-offset-2 scale-102 z-10',
                              )}
                            >
                              {/* Curb Stopper Marker at Back of Stall */}
                              <div className="flex justify-center">
                                <div className="h-1 w-10/12 rounded-full bg-muted-foreground/30 shadow-inner" />
                              </div>

                              {/* Slot ID & Indicators */}
                              <div className="flex items-start justify-between gap-1">
                                <span className="font-mono text-base font-extrabold tracking-tight">
                                  Bay {slot.code}
                                </span>
                                {isUserSlot && (
                                  <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs animate-bounce">
                                    <MapPin className="size-3" />
                                  </span>
                                )}
                                {isHeld && !isUserSlot && (
                                  <span className="flex size-5 items-center justify-center rounded-full bg-amber-500 text-white animate-spin">
                                    <Zap className="size-3" />
                                  </span>
                                )}
                                {isBlocked && (
                                  <Lock className="size-3.5 text-amber-600 dark:text-amber-400" />
                                )}
                                {adminMode && typeof slot.priority === 'number' && (
                                  <span
                                    className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground"
                                    title={`Priority: ${slot.priority}`}
                                  >
                                    P:{slot.priority}
                                  </span>
                                )}
                              </div>

                              {/* Middle Stencil / Status */}
                              <div className="my-auto text-center">
                                {isUserSlot ? (
                                  <span className="inline-block rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                                    YOUR VEHICLE
                                  </span>
                                ) : isOccupied ? (
                                  <div className="truncate font-mono text-[11px] font-semibold text-rose-700 dark:text-rose-400">
                                    {slot.occupant?.vehicleNumber ?? 'OCCUPIED'}
                                  </div>
                                ) : isHeld ? (
                                  <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                    HOLDING…
                                  </span>
                                ) : isBlocked ? (
                                  <span className="truncate text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                    {slot.blockedReason || 'BLOCKED'}
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-medium tracking-wide text-emerald-700 dark:text-emerald-400">
                                    AVAILABLE
                                  </span>
                                )}
                              </div>

                              {/* Stall Entrance Line & Badges */}
                              <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
                                <span className="font-mono text-[9px]">▲ ENTRY</span>
                                {isDisabled && (
                                  <span className="rounded bg-destructive/10 px-1 text-[9px] font-bold text-destructive">
                                    OFF
                                  </span>
                                )}
                                {isArchived && (
                                  <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">
                                    ARCH
                                  </span>
                                )}
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* Informational Click Dialog for Non-Admin Portal */}
      <Dialog
        open={infoDialogSlot !== null}
        onOpenChange={(open) => !open && setInfoDialogSlot(null)}
      >
        <DialogContent closeLabel={t('common.close')}>
          {infoDialogSlot && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-lg">
                  <span className="font-mono font-bold text-primary">
                    {infoDialogSlot.slot.code}
                  </span>
                  <span>— {infoDialogSlot.block.name}</span>
                </DialogTitle>
                <DialogDescription>
                  Zone: {infoDialogSlot.zone.name} (
                  {t(`vehicleTypes.${infoDialogSlot.zone.vehicleType}`)})
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm text-muted-foreground">Current Status</span>
                  <StatusBadge tone={SLOT_TONE[infoDialogSlot.slot.status]} dot>
                    {t(`parking.slotStatus.${infoDialogSlot.slot.status}`)}
                  </StatusBadge>
                </div>

                {infoDialogSlot.slot.status === 'AVAILABLE' && (
                  <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3.5 text-sm">
                    <Info className="size-5 shrink-0 text-primary mt-0.5" />
                    <p className="text-muted-foreground">
                      This slot is currently available. CPVTS automatically selects the
                      best valid slot when you park.
                    </p>
                  </div>
                )}

                {infoDialogSlot.slot.occupant && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Vehicle:</span>
                      <span className="font-mono font-bold">
                        {infoDialogSlot.slot.occupant.vehicleNumber}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Duration:</span>
                      <span>
                        {infoDialogSlot.slot.occupant.currentDurationHours} hr(s)
                      </span>
                    </div>
                  </div>
                )}

                {infoDialogSlot.slot.blockedReason && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                    <strong>Blocked Reason:</strong> {infoDialogSlot.slot.blockedReason}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button onClick={() => setInfoDialogSlot(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
