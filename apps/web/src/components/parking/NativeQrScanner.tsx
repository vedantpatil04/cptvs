import {
  BarcodeFormat,
  BarcodeScanner,
  LensFacing,
  type PermissionStatus,
} from '@capacitor-mlkit/barcode-scanning';
import { Flashlight, FlashlightOff, KeyRound, LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { ScannerFailureView } from './ScannerFailureView';
import type { QrScannerProps, ScannerFailure } from './scanner-types';

/** Class on <html> while the native camera preview is behind the (transparent) WebView. */
const ACTIVE_CLASS = 'qr-scanning';

/** After this long without a code, suggest the flashlight (poor lighting). */
const LOW_LIGHT_HINT_MS = 8_000;

type Phase = 'starting' | 'scanning' | { failure: ScannerFailure };

const failureOf = (error: unknown): ScannerFailure => {
  const text = String((error as { message?: string } | null)?.message ?? error).toLowerCase();
  if (text.includes('permission') || text.includes('denied')) return 'permission_denied';
  if (text.includes('no camera') || text.includes('not available') || text.includes('lens')) {
    return 'no_camera';
  }
  if (text.includes('in use') || text.includes('busy') || text.includes('could not open')) {
    return 'camera_busy';
  }
  return 'error';
};

/**
 * Real-time rear-camera QR scanning inside the Android app (Capacitor + ML Kit). The camera
 * preview is drawn behind the WebView, which is made transparent while scanning; nothing is
 * photographed. The camera is released as soon as a code is read, when the screen is left or
 * the scanner is closed.
 */
export function NativeQrScanner({ onScan, onCancel, onUseCode }: QrScannerProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('starting');
  const [attempt, setAttempt] = useState(0);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [dark, setDark] = useState(false);
  const handled = useRef(false);

  // Latest callbacks without restarting the camera when the parent re-renders.
  const callbacks = useRef({ onScan, onCancel, onUseCode });
  useEffect(() => {
    callbacks.current = { onScan, onCancel, onUseCode };
  });

  useEffect(() => {
    let cancelled = false;
    let started = false;
    let listener: { remove: () => Promise<void> } | null = null;
    let errorListener: { remove: () => Promise<void> } | null = null;
    let lowLightTimer: number | undefined;
    handled.current = false;

    const release = async () => {
      window.clearTimeout(lowLightTimer);
      document.documentElement.classList.remove(ACTIVE_CLASS);
      try {
        await listener?.remove();
        await errorListener?.remove();
        if (started) {
          started = false;
          await BarcodeScanner.disableTorch().catch(() => undefined);
          await BarcodeScanner.stopScan();
        }
      } catch {
        // Releasing is best effort: the plugin also stops the camera when the activity pauses.
      }
    };

    const start = async () => {
      setPhase('starting');
      setTorchOn(false);
      setDark(false);
      try {
        const { supported } = await BarcodeScanner.isSupported();
        if (!supported) throw new Error('no camera');

        let permission: PermissionStatus = await BarcodeScanner.checkPermissions();
        if (permission.camera !== 'granted' && permission.camera !== 'limited') {
          permission = await BarcodeScanner.requestPermissions();
        }
        if (permission.camera !== 'granted' && permission.camera !== 'limited') {
          if (!cancelled) setPhase({ failure: 'permission_denied' });
          return;
        }
        if (cancelled) return;

        listener = await BarcodeScanner.addListener('barcodesScanned', (event) => {
          const value = event.barcodes.map((code) => code.rawValue?.trim()).find(Boolean);
          // The first code wins; later frames (and duplicate reads of the same code) are ignored.
          if (!value || handled.current) return;
          handled.current = true;
          void release().then(() => callbacks.current.onScan(value));
        });
        errorListener = await BarcodeScanner.addListener('scanError', () => {
          if (handled.current) return;
          void release().then(() => setPhase({ failure: 'error' }));
        });

        await BarcodeScanner.startScan({
          formats: [BarcodeFormat.QrCode],
          lensFacing: LensFacing.Back,
        });
        started = true;
        if (cancelled) {
          await release();
          return;
        }
        document.documentElement.classList.add(ACTIVE_CLASS);
        setPhase('scanning');
        const { available } = await BarcodeScanner.isTorchAvailable().catch(() => ({
          available: false,
        }));
        if (!cancelled) setTorchAvailable(available);
        lowLightTimer = window.setTimeout(() => setDark(true), LOW_LIGHT_HINT_MS);
      } catch (error) {
        await release();
        if (!cancelled) setPhase({ failure: failureOf(error) });
      }
    };

    void start();
    return () => {
      cancelled = true;
      void release();
    };
  }, [attempt]);

  const toggleTorch = useCallback(async () => {
    try {
      await BarcodeScanner.toggleTorch();
      setTorchOn((await BarcodeScanner.isTorchEnabled()).enabled);
    } catch {
      setTorchAvailable(false);
    }
  }, []);

  const failure = typeof phase === 'object' ? phase.failure : null;

  return createPortal(
    <div
      className={`qr-scanner-overlay fixed inset-0 z-[100] flex flex-col text-white ${
        phase === 'scanning' ? 'bg-transparent' : 'bg-zinc-950'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={t('parking.scan.title')}
    >
      {failure ? (
        <ScannerFailureView
          failure={failure}
          onRetry={() => setAttempt((value) => value + 1)}
          onUseCode={() => callbacks.current.onUseCode()}
          onClose={() => callbacks.current.onCancel()}
          onOpenSettings={() => void BarcodeScanner.openSettings()}
        />
      ) : (
        <>
          <header className="flex items-center justify-between gap-2 bg-black/70 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <h2 className="text-base font-semibold">{t('parking.scan.title')}</h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 text-white hover:bg-white/15"
              aria-label={t('parking.scan.close')}
              onClick={() => callbacks.current.onCancel()}
            >
              <X className="size-6" aria-hidden />
            </Button>
          </header>

          <div className="relative flex flex-1 items-center justify-center p-6">
            {phase === 'starting' ? (
              <div className="flex flex-col items-center gap-3">
                <LoaderCircle className="size-9 animate-spin" aria-hidden />
                <p className="text-sm">{t('parking.scan.starting')}</p>
              </div>
            ) : (
              <div className="relative aspect-square w-full max-w-72 rounded-2xl border-2 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.55)]">
                <span className="absolute -top-0.5 -left-0.5 size-8 rounded-tl-2xl border-t-4 border-l-4 border-primary-foreground" />
                <span className="absolute -top-0.5 -right-0.5 size-8 rounded-tr-2xl border-t-4 border-r-4 border-primary-foreground" />
                <span className="absolute -bottom-0.5 -left-0.5 size-8 rounded-bl-2xl border-b-4 border-l-4 border-primary-foreground" />
                <span className="absolute -right-0.5 -bottom-0.5 size-8 rounded-br-2xl border-r-4 border-b-4 border-primary-foreground" />
              </div>
            )}
          </div>

          <footer className="space-y-3 bg-black/70 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <p className="text-center text-sm" aria-live="polite">
              {dark && torchAvailable && !torchOn
                ? t('parking.scan.lowLight')
                : t('parking.scan.hint')}
            </p>
            <div className="flex gap-2">
              {torchAvailable && (
                <Button
                  type="button"
                  size="lg"
                  variant={torchOn ? 'default' : 'secondary'}
                  className="h-12 flex-1"
                  aria-pressed={torchOn}
                  onClick={() => void toggleTorch()}
                >
                  {torchOn ? <FlashlightOff aria-hidden /> : <Flashlight aria-hidden />}
                  {torchOn ? t('parking.scan.torchOff') : t('parking.scan.torchOn')}
                </Button>
              )}
              <Button
                type="button"
                size="lg"
                variant="secondary"
                className="h-12 flex-1"
                onClick={() => callbacks.current.onUseCode()}
              >
                <KeyRound aria-hidden />
                {t('parking.scan.useCode')}
              </Button>
            </div>
          </footer>
        </>
      )}
    </div>,
    document.body,
  );
}
