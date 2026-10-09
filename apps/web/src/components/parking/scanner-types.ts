/** Why the camera could not be used; the UI offers the 6-digit code and manual lookup instead. */
export type ScannerFailure =
  'permission_denied' | 'no_camera' | 'insecure_context' | 'camera_busy' | 'error';

export interface QrScannerProps {
  /** Called once with the raw text of the first QR code read. The camera is already released. */
  onScan: (value: string) => void;
  /** The operator closed the scanner without scanning. */
  onCancel: () => void;
  /** Offers the 6-digit code instead (the scanner is closed first). */
  onUseCode: () => void;
}
