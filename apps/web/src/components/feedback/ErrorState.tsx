import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Shows a retry button when provided. */
  onRetry?: () => void;
  /** Additional actions rendered next to the retry button. */
  actions?: ReactNode;
  className?: string;
}

/** Explains that something failed and what the user can do next. */
export function ErrorState({ title, description, onRetry, actions, className }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-4 px-6 py-10 text-center', className)}
    >
      <div className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlert className="size-6" aria-hidden />
      </div>
      <div className="max-w-md space-y-1">
        <p className="font-semibold">{title ?? t('states.errorTitle')}</p>
        <p className="text-sm text-muted-foreground">
          {description ?? t('states.errorDescription')}
        </p>
      </div>
      {(onRetry || actions) && (
        <div className="flex flex-wrap justify-center gap-2">
          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
