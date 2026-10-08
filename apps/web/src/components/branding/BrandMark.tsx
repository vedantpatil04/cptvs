import { SquareParking } from 'lucide-react';

import { branding } from '@/config/branding';
import { cn } from '@/lib/utils';

interface BrandMarkProps {
  /** `full` shows the product name under the short name. */
  variant?: 'compact' | 'full';
  /** Colour scheme for the surface the mark sits on. */
  tone?: 'default' | 'inverted';
  className?: string;
}

export function BrandMark({ variant = 'full', tone = 'default', className }: BrandMarkProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <div
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-lg',
          tone === 'inverted'
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'bg-primary text-primary-foreground',
        )}
        aria-hidden
      >
        <SquareParking className="size-6" />
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-base font-bold tracking-wide">{branding.shortName}</p>
        {variant === 'full' && (
          <p
            className={cn(
              'line-clamp-2 text-xs',
              tone === 'inverted' ? 'text-sidebar-muted-foreground' : 'text-muted-foreground',
            )}
          >
            {branding.productName}
          </p>
        )}
      </div>
    </div>
  );
}
