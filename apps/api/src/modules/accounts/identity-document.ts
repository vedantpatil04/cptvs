import { createHash } from 'node:crypto';

import {
  MAX_IDENTITY_DOCUMENT_BYTES,
  type IdentityDocumentType,
  type IdentityDocumentUpload,
} from '@cpvts/shared';

import { accountErrors } from './accounts.errors.js';

export interface DecodedDocument {
  fileName: string;
  mimeType: IdentityDocumentType;
  content: Uint8Array<ArrayBuffer>;
  sizeBytes: number;
  sha256: string;
}

const startsWith = (bytes: Uint8Array, signature: number[]): boolean =>
  signature.every((value, index) => bytes[index] === value);

/** Recognises the real file type from its first bytes; the declared type is not trusted. */
const sniff = (bytes: Uint8Array): IdentityDocumentType | null => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
};

/** Keeps only a safe display name (no paths or control characters). */
const safeFileName = (name: string, mimeType: IdentityDocumentType): string => {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[^\p{L}\p{N} ._()-]/gu, '')
    .trim()
    .slice(0, 120);
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }[mimeType];
  return cleaned || `identity-document.${extension}`;
};

export const decodeIdentityDocument = (upload: IdentityDocumentUpload): DecodedDocument => {
  const buffer = Buffer.from(upload.contentBase64, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_IDENTITY_DOCUMENT_BYTES) {
    throw accountErrors.invalidDocument();
  }
  const mimeType = sniff(buffer);
  if (!mimeType) throw accountErrors.invalidDocument();

  const content = new Uint8Array(buffer.length);
  content.set(buffer);
  return {
    fileName: safeFileName(upload.fileName, mimeType),
    mimeType,
    content,
    sizeBytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
};
