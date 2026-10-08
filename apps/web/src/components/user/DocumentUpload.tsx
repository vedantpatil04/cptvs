import type { IdentityDocumentUpload } from '@cpvts/shared';
import { FileCheck2, Trash2, Upload } from 'lucide-react';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatFileSize, readIdentityDocument } from '@/lib/identity-document';
import { cn } from '@/lib/utils';

export interface PickedDocument {
  document: IdentityDocumentUpload;
  sizeBytes: number;
}

interface DocumentUploadProps {
  value: PickedDocument | null;
  onChange: (value: PickedDocument | null) => void;
  /** Translation key of a validation problem to show. */
  error: string | null;
  onError: (error: string | null) => void;
}

/** A touch-friendly picker for the college ID: opens the camera or file chooser on phones. */
export function DocumentUpload({ value, onChange, error, onError }: DocumentUploadProps) {
  const { t } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const result = await readIdentityDocument(file);
    if (result.ok) {
      onError(null);
      onChange({ document: result.document, sizeBytes: result.sizeBytes });
    } else {
      onChange(null);
      onError(result.error);
    }
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t('verification.document.label')}</Label>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
        className="sr-only"
        aria-describedby={`${id}-hint`}
        aria-invalid={error !== null}
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          // Allow choosing the same file again after removing it.
          event.target.value = '';
        }}
      />
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
          <FileCheck2 className="size-6 shrink-0 text-success" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{value.document.fileName}</p>
            <p className="text-xs text-muted-foreground">{formatFileSize(value.sizeBytes)}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('verification.document.remove')}
            onClick={() => onChange(null)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn(
            'flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-card px-4 py-6 text-center text-sm transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
            error && 'border-destructive',
          )}
        >
          <Upload className="size-6 text-primary" aria-hidden />
          <span className="font-medium">{t('verification.document.choose')}</span>
        </button>
      )}
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {t('verification.document.hint')}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error as never)}
        </p>
      )}
    </div>
  );
}
