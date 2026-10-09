import jsQR from 'jsqr';
import { Flashlight, FlashlightOff, FlipHorizontal, KeyRound, LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { ScannerFailureView } from './ScannerFailureView';
import type { QrScannerProps, ScannerFailure } from './scanner-types';

/** Frames are analysed at most this often and no wider than this, to stay light on phones. */
const SCAN_INTERVAL_MS = 120;
const MAX_ANALYSIS_WIDTH = 720;

/** After this long without a code, suggest the flashlight (poor lighting). */
const LOW_LIGHT_HINT_MS = 8_000;

type Phase = 'starting' | 'scanning' | { failure: ScannerFailure };

type TorchTrack = MediaStreamTrack & {
  getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
};

const failureOf = (error: unknown): ScannerFailure => {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'permission_denied';
  }
  if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    name === 'OverconstrainedError'
  ) {
    return 'no_camera';
  }
  if (name === 'NotReadableError' || name === 'AbortError') return 'camera_busy';
  return 'error';
};

/**
 * Browser camera scanner (needs HTTPS or localhost): rear camera video, QR decoding with
 * jsQR, torch where the camera exposes it. The stream is released after a scan, on close and
 * when the screen is left.
 */
export function WebQrScanner({ onScan, onCancel, onUseCode }: QrScannerProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackRef = useRef<TorchTrack | null>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [attempt, setAttempt] = useState(0);
  const [cameras, setCameras] = useState(0);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [dark, setDark] = useState(false);

  const callbacks = useRef({ onScan, onCancel, onUseCode });
  useEffect(() => {
    callbacks.current = { onScan, onCancel, onUseCode };
  });

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let lowLightTimer: number | undefined;
    let handled = false;

    const release = () => {
      window.clearTimeout(timer);
      window.clearTimeout(lowLightTimer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      trackRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const analyse = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (cancelled || handled) return;
      if (video && canvas && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth) {
        const scale = Math.min(1, MAX_ANALYSIS_WIDTH / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(image.data, image.width, image.height, {
            inversionAttempts: 'attemptBoth',
          });
          const value = code?.data.trim();
          if (value) {
            handled = true;
            release();
            navigator.vibrate?.(80);
            callbacks.current.onScan(value);
            return;
          }
        }
      }
      timer = window.setTimeout(analyse, SCAN_INTERVAL_MS);
    };

    const start = async () => {
      setPhase('starting');
      setTorchOn(false);
      setDark(false);
      if (!window.isSecureContext) {
        setPhase({ failure: 'insecure_context' });
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase({ failure: 'no_camera' });
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          release();
          return;
        }
        const video = videoRef.current;
        if (!video) {
          release();
          return;
        }
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();
        if (cancelled) return;

        const track = stream.getVideoTracks()[0] as TorchTrack | undefined;
        trackRef.current = track ?? null;
        setTorchAvailable(
          Boolean((track?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch),
        );
        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (!cancelled) setCameras(devices.filter((d) => d.kind === 'videoinput').length);
          })
          .catch(() => undefined);

        setPhase('scanning');
        lowLightTimer = window.setTimeout(() => setDark(true), LOW_LIGHT_HINT_MS);
        analyse();
      } catch (error) {
        release();
        if (!cancelled) setPhase({ failure: failureOf(error) });
      }
    };

    void start();
    return () => {
      cancelled = true;
      release();
    };
  }, [facing, attempt]);

  const toggleTorch = useCallback(async () => {
    const track = trackRef.current;
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

  const failure = typeof phase === 'object' ? phase.failure : null;

  if (failure) {
    return (
      <div className="overflow-hidden rounded-2xl">
        <ScannerFailureView
          failure={failure}
          onRetry={() => setAttempt((value) => value + 1)}
          onUseCode={() => callbacks.current.onUseCode()}
          onClose={() => callbacks.current.onCancel()}
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-black text-white shadow-md">
      <canvas ref={canvasRef} className="hidden" />
      <div className="relative aspect-[4/3] w-full bg-zinc-950 sm:aspect-video">
        <video ref={videoRef} className="size-full object-cover" muted playsInline autoPlay />
        {phase === 'starting' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950">
            <LoaderCircle className="size-8 animate-spin" aria-hidden />
            <p className="text-sm">{t('parking.scan.starting')}</p>
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="aspect-square h-full max-h-64 rounded-2xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1">
          {cameras > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 bg-black/40 text-white hover:bg-black/60"
              aria-label={t('parking.scan.switchCamera')}
              onClick={() =>
                setFacing((value) => (value === 'environment' ? 'user' : 'environment'))
              }
            >
              <FlipHorizontal aria-hidden />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 bg-black/40 text-white hover:bg-black/60"
            aria-label={t('parking.scan.close')}
            onClick={() => callbacks.current.onCancel()}
          >
            <X aria-hidden />
          </Button>
        </div>
      </div>
      <div className="space-y-3 bg-zinc-900 p-3">
        <p className="text-center text-sm text-zinc-200" aria-live="polite">
          {dark && torchAvailable && !torchOn ? t('parking.scan.lowLight') : t('parking.scan.hint')}
        </p>
        <div className="flex gap-2">
          {torchAvailable && (
            <Button
              type="button"
              variant={torchOn ? 'default' : 'secondary'}
              className="h-11 flex-1"
              aria-pressed={torchOn}
              onClick={() => void toggleTorch()}
            >
              {torchOn ? <FlashlightOff aria-hidden /> : <Flashlight aria-hidden />}
              {torchOn ? t('parking.scan.torchOff') : t('parking.scan.torchOn')}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            className="h-11 flex-1"
            onClick={() => callbacks.current.onUseCode()}
          >
            <KeyRound aria-hidden />
            {t('parking.scan.useCode')}
          </Button>
        </div>
      </div>
    </div>
  );
}
