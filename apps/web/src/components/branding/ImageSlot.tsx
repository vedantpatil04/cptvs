import { Bike, Car, SquareParking, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

import { IMAGES, type ImageSlotId } from '@/config/images';
import { cn } from '@/lib/utils';

const FALLBACK_ICON: Record<ImageSlotId, LucideIcon> = {
  hero: SquareParking,
  campus: SquareParking,
  twoWheelerBlock: Bike,
  fourWheelerBlock: Car,
};

interface ImageSlotProps {
  slot: ImageSlotId;
  /** Describes the photo for assistive technology. Leave empty for decorative images. */
  alt?: string;
  className?: string;
}

/**
 * A configurable photo position. Shows the configured image when there is one
 * and loads; otherwise a deliberate, photo-free design made of parking-bay
 * lines. The slot fills its parent, so callers control the size and ratio.
 */
export function ImageSlot({ slot, alt = '', className }: ImageSlotProps) {
  const source = IMAGES[slot];
  const [failed, setFailed] = useState(false);
  const Icon = FALLBACK_ICON[slot];

  if (source && !failed) {
    return (
      <img
        src={source}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={cn('size-full object-cover', className)}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        'relative isolate flex size-full items-end overflow-hidden bg-sidebar text-sidebar-foreground',
        className,
      )}
    >
      <div className="bay-lines absolute inset-x-0 bottom-0 h-3/5 text-sidebar-foreground opacity-80" />
      <div className="absolute inset-x-0 bottom-[calc(60%-1px)] h-px bg-sidebar-foreground/20" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(120%_90%_at_85%_0%,var(--sidebar-accent),transparent_60%)]" />
      <Icon
        className="absolute top-6 right-6 size-16 text-sidebar-foreground/25"
        strokeWidth={1.25}
      />
    </div>
  );
}
