import type * as React from 'react';

import { cn } from '@/lib/utils';

/** Label/value pairs, stacked on phones and side by side on wider screens. */
function DescriptionList({ className, ...props }: React.ComponentProps<'dl'>) {
  return <dl className={cn('divide-y text-sm', className)} {...props} />;
}

function DescriptionItem({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-3 sm:gap-4', className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words sm:col-span-2">{children}</dd>
    </div>
  );
}

export { DescriptionItem, DescriptionList };
