import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** Renders `value` as a QR image (generated locally; nothing is sent anywhere). */
export function useQrDataUrl(value: string, size = 240): string | null {
  const [url, setUrl] = useState<{ value: string; dataUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: size })
      .then((dataUrl) => {
        if (!cancelled) setUrl({ value, dataUrl });
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return url?.value === value ? url.dataUrl : null;
}
