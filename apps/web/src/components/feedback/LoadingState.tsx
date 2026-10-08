import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

interface LoadingStateProps {
  label?: string;
  className?: string;
}

/** Inline loading indicator for a section or card. */
export function LoadingState({ label, className }: LoadingStateProps) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-center gap-3 py-10 text-muted-foreground',
        className,
      )}
    >
      <LoaderCircle className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label ?? t('common.loading')}</span>
    </div>
  );
}

/** Full-viewport loading indicator, used while the session is restored. */
export function FullPageLoader({ label }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <LoadingState label={label} />
    </div>
  );
}
