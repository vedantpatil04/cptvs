import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

/**
 * Semantic tones for statuses across CPVTS. Domain modules map their own
 * states (e.g. slot or payment status) to a tone instead of picking colours.
 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_VARIANT = {
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
} as const satisfies Record<StatusTone, string>;

interface StatusBadgeProps {
  tone: StatusTone;
  children: ReactNode;
  /** Shows a leading dot, useful for live/online indicators. */
  dot?: boolean;
}

export function StatusBadge({ tone, children, dot = false }: StatusBadgeProps) {
  return (
    <Badge variant={TONE_VARIANT[tone]}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </Badge>
  );
}
