import { randomBytes, randomInt } from 'node:crypto';

import { IDENTIFIER_ALPHABET } from '@cpvts/shared';

/** Cryptographically random code from the unambiguous Crockford alphabet. */
const randomCode = (length: number): string =>
  Array.from({ length }, () => IDENTIFIER_ALPHABET[randomInt(IDENTIFIER_ALPHABET.length)]).join('');

/** Parking Session Number, e.g. CPVTS-P-7K4M92QX (32⁸ ≈ 1.1 × 10¹² possibilities). */
export const newSessionNumber = (): string => `CPVTS-P-${randomCode(8)}`;

/** Permanent receipt number, e.g. CPVTS-R-2026-8F3K2Q9M. Distinct from the session number. */
export const newReceiptNumber = (year: number): string => `CPVTS-R-${year}-${randomCode(8)}`;

/** Simulated payment transaction ID, e.g. TXN-7F84K29MQA. */
export const newTransactionId = (): string => `TXN-${randomCode(10)}`;

/** Non-guessable opaque reference (256 bits) for entry QR and receipt verification. */
export const newOpaqueReference = (): string => randomBytes(32).toString('base64url');

/** Secret identifying one allocation attempt's slot hold. */
export const newHoldToken = (): string => randomBytes(24).toString('base64url');
