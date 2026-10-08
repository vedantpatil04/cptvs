import { cn } from '@/lib/utils';

/** A vehicle registration number set like a number plate. */
export function PlateBadge({ value, className }: { value: string; className?: string }) {
  return (
    <span
      dir="ltr"
      translate="no"
      className={cn(
        'inline-flex items-center rounded-md border-2 border-foreground/80 bg-white px-2.5 py-0.5 font-mono text-base font-bold tracking-[0.14em] text-neutral-900',
        className,
      )}
    >
      {value}
    </span>
  );
}
