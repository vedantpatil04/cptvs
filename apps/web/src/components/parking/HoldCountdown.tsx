import { Clock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useServerNow } from '@/hooks/use-server-now';
import { formatClock } from '@/lib/duration';
import { cn } from '@/lib/utils';

interface HoldCountdownProps {
  /** ISO instant the temporary hold ends (server time). */
  expiresAt: string;
  /** Total length of the hold in seconds, for the progress bar. */
  totalSeconds: number;
  /** Called once when the hold runs out. */
  onExpire?: () => void;
  label?: string;
  className?: string;
}

/**
 * Visible countdown of a temporary slot hold. It counts to the server's expiry instant using the
 * server-corrected clock, so a wrong device clock or a backgrounded app can not stretch the hold.
 */
export function HoldCountdown({
  expiresAt,
  totalSeconds,
  onExpire,
  label,
  className,
}: HoldCountdownProps) {
  const { t } = useTranslation();
  const now = useServerNow();
  const remaining = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  const expired = remaining === 0;

  const notified = useRef(false);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });
  useEffect(() => {
    if (expired && !notified.current) {
      notified.current = true;
      onExpireRef.current?.();
    }
    if (!expired) notified.current = false;
  }, [expired]);

  const share = totalSeconds > 0 ? Math.min(100, (remaining / totalSeconds) * 100) : 0;
  const urgent = remaining <= 60;

  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        urgent ? 'border-warning/50 bg-warning/10' : 'bg-muted/50',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Clock className="size-4" aria-hidden />
          {label ?? t('parkMyVehicle.holdExpires')}
        </span>
        <span role="timer" className="font-mono text-2xl font-bold tabular-nums">
          {formatClock(remaining).slice(3)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            urgent ? 'bg-warning' : 'bg-brand',
          )}
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}
