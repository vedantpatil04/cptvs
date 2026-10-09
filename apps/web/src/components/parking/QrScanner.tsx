import { Capacitor } from '@capacitor/core';

import { NativeQrScanner } from './NativeQrScanner';
import type { QrScannerProps } from './scanner-types';
import { WebQrScanner } from './WebQrScanner';

/**
 * The Security QR scanner. Inside the Android app it opens the rear camera through the native
 * ML Kit plugin; in a browser it uses the device camera over HTTPS. Both read the
 * Parking Session QR only and hand the raw text to the server, which validates it.
 */
export function QrScanner(props: QrScannerProps) {
  return Capacitor.isNativePlatform() ? (
    <NativeQrScanner {...props} />
  ) : (
    <WebQrScanner {...props} />
  );
}
