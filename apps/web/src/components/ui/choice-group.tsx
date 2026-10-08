import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export interface Choice<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface ChoiceGroupProps<T extends string> {
  name: string;
  value: T | undefined;
  options: Choice<T>[];
  onChange: (value: T) => void;
  /** Accessible group label (rendered by the surrounding form label). */
  'aria-labelledby'?: string;
  'aria-invalid'?: boolean;
  className?: string;
}

/** Large, touch-friendly radio buttons for a small set of options. */
function ChoiceGroup<T extends string>({
  name,
  value,
  options,
  onChange,
  className,
  ...aria
}: ChoiceGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      className={cn('grid gap-2', options.length > 2 ? 'grid-cols-3' : 'grid-cols-2', className)}
      {...aria}
    >
      {options.map(({ value: optionValue, label, icon: Icon }) => {
        const checked = optionValue === value;
        return (
          <label
            key={optionValue}
            className={cn(
              'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
              checked
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <input
              type="radio"
              name={name}
              value={optionValue}
              checked={checked}
              onChange={() => onChange(optionValue)}
              className="sr-only"
            />
            {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
            {label}
          </label>
        );
      })}
    </div>
  );
}

function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { ChoiceGroup, NativeSelect };
