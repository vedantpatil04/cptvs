import { entryQrPayload, type ExitCodeResponse } from '@cpvts/shared';
import { KeyRound, LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useServerNow } from '@/hooks/use-server-now';
import { errorMessage } from '@/lib/error-message';
import { formatClock } from '@/lib/duration';
import { cn } from '@/lib/utils';

import { QrCode } from './QrCode';

interface ExitPassProps {
  /** The session's entry reference (what the Parking Session QR encodes). */
  entryReference: string | null;
  /** Asks the server for a fresh 6-digit code for this session. */
  issueCode: () => Promise<ExitCodeResponse>;
  qrSize?: number;
  className?: string;
}

/**
 * What the driver shows at the exit gate: the Parking Session QR, and, if the QR cannot be
 * scanned, a short-lived 6-digit code issued by the server for this session only.
 */
export function ExitPass({ entryReference, issueCode, qrSize = 176, className }: ExitPassProps) {
  const { t } = useTranslation();
  const [issued, setIssued] = useState<ExitCodeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const now = useServerNow(issued !== null);

  const request = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setIssued(await issueCode());
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, [issueCode]);

  const remaining = issued
    ? Math.max(0, Math.ceil((Date.parse(issued.expiresAt) - now) / 1000))
    : 0;
  const expired = issued !== null && remaining === 0;

  return (
    <div className={cn('flex flex-col items-center gap-4 text-center', className)}>
      {entryReference && (
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('parking.exitPass.qrTitle')}
          </p>
          <QrCode
            value={entryQrPayload(entryReference)}
            label={t('parking.entry.entryQrTitle')}
            size={qrSize}
            className="border"
          />
          <p className="text-xs text-muted-foreground">{t('parking.exitPass.qrHint')}</p>
        </div>
      )}

      <div className="w-full space-y-2 border-t pt-4">
        {issued && !expired ? (
          <>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('parking.exitPass.codeTitle')}
            </p>
            <p
              className="font-mono text-4xl font-bold tracking-[0.3em] tabular-nums"
              aria-label={issued.code.split('').join(' ')}
            >
              {issued.code}
            </p>
            <p className="text-xs text-muted-foreground" role="timer">
              {t('parking.exitPass.expiresIn', { time: formatClock(remaining).slice(3) })}
            </p>
          </>
        ) : (
          <>
            {expired && (
              <p className="text-sm font-medium text-warning">{t('parking.exitPass.expired')}</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 w-full"
              onClick={() => void request()}
              disabled={loading}
            >
              {loading ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : expired ? (
                <RefreshCw aria-hidden />
              ) : (
                <KeyRound aria-hidden />
              )}
              {expired ? t('parking.exitPass.newCode') : t('parking.exitPass.showCode')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('parking.exitPass.codeHint')}</p>
          </>
        )}
        {error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(t, error)}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
