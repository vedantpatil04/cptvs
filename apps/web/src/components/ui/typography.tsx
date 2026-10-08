import type * as React from 'react';

import { cn } from '@/lib/utils';

/** Page title. One per page. */
function H1({ className, ...props }: React.ComponentProps<'h1'>) {
  return (
    <h1
      className={cn('text-2xl font-semibold tracking-tight text-balance sm:text-3xl', className)}
      {...props}
    />
  );
}

/** Section title. */
function H2({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('text-xl font-semibold tracking-tight', className)} {...props} />;
}

/** Sub-section title. */
function H3({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('text-lg font-semibold tracking-tight', className)} {...props} />;
}

/** Introductory paragraph under a heading. */
function Lead({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-base text-muted-foreground', className)} {...props} />;
}

/** Secondary, low-emphasis text. */
function Muted({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { H1, H2, H3, Lead, Muted };
