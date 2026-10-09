import jsQR from 'jsqr';
import {
  Camera,
  CheckCircle2,
  FlipHorizontal,
  LoaderCircle,
  RefreshCw,
  Search,
  VideoOff,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export interface CameraQrScannerProps {
  onScan: (qrData: string) => void;
  onManualFallback?: () => void;
  onClose?: () => void;
}

type ScannerStatus =
  | 'requesting'
  | 'scanning'
  | 'detected'
  | 'permission_denied'
  | 'unavailable'
  | 'error';

export function CameraQrScanner({
  onScan,
  onManualFallback,
  onClose,
}: CameraQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [status, setStatus] = useState<ScannerStatus>('requesting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [detectedText, setDetectedText] = useState<string | null>(null);

  // Stop camera tracks cleanly
  const stopStream = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  // Check for device camera support
  useEffect(() => {
    if (navigator?.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          const videoInputs = devices.filter((d) => d.kind === 'videoinput');
          setHasMultipleCameras(videoInputs.length > 1);
        })
        .catch(() => {});
    }
  }, []);

  // Start video stream
  useEffect(() => {
    let cancelled = false;

    async function initCamera() {
      setStatus('requesting');
      setErrorMessage(null);
      stopStream();

      if (!navigator?.mediaDevices?.getUserMedia) {
        setStatus('unavailable');
        setErrorMessage('Camera access is not supported by your browser or environment.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true'); // Required for iOS/WebView
          await videoRef.current.play();
          if (!cancelled) {
            setStatus('scanning');
          }
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const e = err as { name?: string; message?: string };
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
          setStatus('permission_denied');
          setErrorMessage('Camera access was denied. Please allow camera permissions in your browser or device settings.');
        } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
          setStatus('unavailable');
          setErrorMessage('No camera device found on this system.');
        } else {
          setStatus('error');
          setErrorMessage(e.message || 'Unable to start camera.');
        }
      }
    }

    void initCamera();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode]);

  // QR detection loop using jsQR
  useEffect(() => {
    if (status !== 'scanning') return;

    let scanActive = true;

    const scanFrame = () => {
      if (!scanActive) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth',
            });

            if (code && code.data.trim()) {
              scanActive = false;
              stopStream();
              setStatus('detected');
              setDetectedText(code.data.trim());

              // Haptic feedback if supported on mobile
              if (navigator.vibrate) {
                try {
                  navigator.vibrate(100);
                } catch {
                  // Ignore
                }
              }

              onScan(code.data.trim());
              return;
            }
          } catch {
            // Frame processing error, keep scanning
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(scanFrame);
    };

    animFrameRef.current = requestAnimationFrame(scanFrame);

    return () => {
      scanActive = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [status, onScan]);

  const toggleCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-black text-white shadow-xl max-w-xl mx-auto">
      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Header bar */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-2">
          <Camera className="size-4 text-primary" />
          <span className="text-xs font-semibold tracking-wide uppercase">
            Parking Session QR Scanner
          </span>
        </div>

        <div className="flex items-center gap-1">
          {hasMultipleCameras && status === 'scanning' && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleCamera}
              className="text-white hover:bg-white/20 size-8"
              title="Switch camera"
            >
              <FlipHorizontal className="size-4" />
            </Button>
          )}

          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                stopStream();
                onClose();
              }}
              className="text-white hover:bg-white/20 size-8"
              title="Close scanner"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Camera Viewport */}
      <div className="relative aspect-[4/3] sm:aspect-video w-full flex items-center justify-center bg-zinc-950 overflow-hidden">
        {/* Video feed */}
        <video
          ref={videoRef}
          className={`h-full w-full object-cover ${
            status === 'scanning' ? 'opacity-100' : 'opacity-0'
          }`}
          muted
          autoPlay
          playsInline
        />

        {/* Viewfinder Target Box and Laser Line */}
        {status === 'scanning' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
            <div className="relative size-60 sm:size-72 rounded-2xl border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
              {/* Corner markers */}
              <div className="absolute -top-1 -left-1 size-6 border-t-4 border-l-4 border-primary rounded-tl-lg" />
              <div className="absolute -top-1 -right-1 size-6 border-t-4 border-r-4 border-primary rounded-tr-lg" />
              <div className="absolute -bottom-1 -left-1 size-6 border-b-4 border-l-4 border-primary rounded-bl-lg" />
              <div className="absolute -bottom-1 -right-1 size-6 border-b-4 border-r-4 border-primary rounded-br-lg" />

              {/* Scanning red laser line */}
              <div className="absolute inset-x-2 top-0 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_2px_rgba(239,68,68,0.8)] animate-[scan_2s_ease-in-out_infinite]" />

              <p className="absolute -bottom-8 inset-x-0 text-center text-[11px] font-medium text-white/90 drop-shadow">
                Point camera at the driver's Parking Session QR
              </p>
            </div>
          </div>
        )}

        {/* Status: Requesting */}
        {status === 'requesting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-zinc-900">
            <LoaderCircle className="size-8 text-primary animate-spin" />
            <p className="text-sm font-medium text-white/90">Initializing camera...</p>
          </div>
        )}

        {/* Status: Detected */}
        {status === 'detected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-zinc-900/95 animate-in fade-in zoom-in-95">
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
              <CheckCircle2 className="size-8" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-bold text-white">QR Code Detected!</p>
              <p className="font-mono text-xs text-zinc-400 truncate max-w-xs">{detectedText}</p>
            </div>
            <p className="text-xs text-zinc-400">Validating session with server...</p>
          </div>
        )}

        {/* Status: Permission Denied */}
        {status === 'permission_denied' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-zinc-900">
            <VideoOff className="size-10 text-amber-400" />
            <div className="space-y-1 max-w-sm">
              <p className="text-sm font-bold text-white">Camera Access Denied</p>
              <p className="text-xs text-zinc-400">
                {errorMessage || 'Browser camera permissions are blocked.'}
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-white border-zinc-700 hover:bg-zinc-800"
                onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
              >
                <RefreshCw className="size-3.5 mr-1.5" />
                Retry
              </Button>
              {onManualFallback && (
                <Button type="button" size="sm" onClick={onManualFallback}>
                  <Search className="size-3.5 mr-1.5" />
                  Manual Search
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Status: Unavailable or Error */}
        {(status === 'unavailable' || status === 'error') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-zinc-900">
            <VideoOff className="size-10 text-zinc-500" />
            <div className="space-y-1 max-w-sm">
              <p className="text-sm font-bold text-white">Camera Unavailable</p>
              <p className="text-xs text-zinc-400">
                {errorMessage || 'No compatible video camera stream could be established.'}
              </p>
            </div>
            {onManualFallback && (
              <Button type="button" size="sm" onClick={onManualFallback} className="mt-2">
                <Search className="size-3.5 mr-1.5" />
                Switch to Manual Lookup
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Footer controls */}
      <div className="flex items-center justify-between p-3 bg-zinc-900 border-t border-zinc-800 text-xs">
        <span className="text-zinc-400 text-[11px]">
          Accepts Session Entry QR only (never Receipt QR)
        </span>

        {onManualFallback && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              stopStream();
              onManualFallback();
            }}
            className="text-primary hover:text-primary-foreground hover:bg-primary h-7 text-xs"
          >
            <Search className="size-3 mr-1" />
            Enter manually
          </Button>
        )}
      </div>
    </div>
  );
}
