import {
  IDENTITY_DOCUMENT_TYPES,
  MAX_IDENTITY_DOCUMENT_BYTES,
  VALIDATION_MESSAGES,
  type IdentityDocumentType,
  type IdentityDocumentUpload,
} from '@cpvts/shared';

export type DocumentReadResult =
  | { ok: true; document: IdentityDocumentUpload; sizeBytes: number }
  | {
      ok: false;
      error: typeof VALIDATION_MESSAGES.documentType | typeof VALIDATION_MESSAGES.documentTooLarge;
    };

const BY_EXTENSION: Record<string, IdentityDocumentType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
};

/** Some Android WebViews report no MIME type for picked files, so fall back to the extension. */
const documentType = (file: File): IdentityDocumentType | null => {
  const declared = (IDENTITY_DOCUMENT_TYPES as readonly string[]).includes(file.type)
    ? (file.type as IdentityDocumentType)
    : null;
  return declared ?? BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
};

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });

/**
 * Checks a picked file against the same limits the server enforces (JPEG,
 * PNG or PDF, at most 2 MB) and encodes it for upload. The server repeats the
 * checks and verifies the real file type from its content.
 */
export const readIdentityDocument = async (file: File): Promise<DocumentReadResult> => {
  const mimeType = documentType(file);
  if (!mimeType) return { ok: false, error: VALIDATION_MESSAGES.documentType };
  if (file.size > MAX_IDENTITY_DOCUMENT_BYTES || file.size === 0) {
    return { ok: false, error: VALIDATION_MESSAGES.documentTooLarge };
  }
  const contentBase64 = await toBase64(file);
  return {
    ok: true,
    sizeBytes: file.size,
    document: { fileName: file.name, mimeType, contentBase64 },
  };
};

export const formatFileSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
