import { KeyRound, RefreshCw, Settings, VideoOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import type { ScannerFailure } from './scanner-types';

interface ScannerFailureViewProps {
  failure: ScannerFailure;
  onRetry: () => void;
  onUseCode: () => void;
  onClose: () => void;
  /** Native only: opens the app's permission settings. */
  onOpenSettings?: () => void;
}

/** What the operator sees when the camera cannot be used, with the ways forward. */
export function ScannerFailureView({
  failure,
  onRetry,
  onUseCode,
  onClose,
  onOpenSettings,
}: ScannerFailureViewProps) {
  const { t } = useTranslation();
  const canRetry = failure !== 'no_camera' && failure !== 'insecure_context';
  return (
    <div
      role="alert"
      className="flex h-full min-h-72 flex-col items-center justify-center gap-4 bg-zinc-950 p-6 text-center text-white"
    >
      <VideoOff className="size-10 text-amber-400" aria-hidden />
      <div className="max-w-sm space-y-1">
        <p className="text-base font-bold">{t(`parking.scan.failure.${failure}.title`)}</p>
        <p className="text-sm text-zinc-300">{t(`parking.scan.failure.${failure}.body`)}</p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-2">
        {failure === 'permission_denied' && onOpenSettings && (
          <Button size="lg" onClick={onOpenSettings}>
            <Settings aria-hidden />
            {t('parking.scan.openSettings')}
          </Button>
        )}
        {canRetry && (
          <Button size="lg" variant="secondary" onClick={onRetry}>
            <RefreshCw aria-hidden />
            {t('common.retry')}
          </Button>
        )}
        <Button size="lg" variant="secondary" onClick={onUseCode}>
          <KeyRound aria-hidden />
          {t('parking.scan.useCode')}
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="text-white hover:bg-white/10"
          onClick={onClose}
        >
          {t('parking.scan.close')}
        </Button>
      </div>
    </div>
  );
}
