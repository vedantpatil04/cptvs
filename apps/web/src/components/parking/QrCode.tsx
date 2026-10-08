import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useQrDataUrl } from './use-qr-data-url';

export function QrCode({
  value,
  label,
  size = 180,
  className,
}: {
  value: string;
  /** Accessible description of what the code is for. */
  label: string;
  size?: number;
  className?: string;
}) {
  const dataUrl = useQrDataUrl(value, size * 2);
  return dataUrl ? (
    <img
      src={dataUrl}
      alt={label}
      width={size}
      height={size}
      className={cn('rounded-md bg-white p-1', className)}
    />
  ) : (
    <Skeleton style={{ width: size, height: size }} className={className} />
  );
}
