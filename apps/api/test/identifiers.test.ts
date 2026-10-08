import {
  OPAQUE_REFERENCE_PATTERN,
  RECEIPT_NUMBER_PATTERN,
  SESSION_NUMBER_PATTERN,
  TRANSACTION_ID_PATTERN,
} from '@cpvts/shared';
import { describe, expect, it } from 'vitest';

import {
  newOpaqueReference,
  newReceiptNumber,
  newSessionNumber,
  newTransactionId,
} from '../src/lib/identifiers.js';

const SAMPLES = 20_000;

describe('identifiers', () => {
  it.each([
    ['session numbers', newSessionNumber, SESSION_NUMBER_PATTERN],
    ['receipt numbers', () => newReceiptNumber(2026), RECEIPT_NUMBER_PATTERN],
    ['transaction IDs', newTransactionId, TRANSACTION_ID_PATTERN],
    ['opaque references', newOpaqueReference, OPAQUE_REFERENCE_PATTERN],
  ] as const)('%s match their format and do not repeat', (_name, generate, pattern) => {
    const values = new Set<string>();
    for (let i = 0; i < SAMPLES; i += 1) {
      const value = generate();
      expect(value).toMatch(pattern);
      values.add(value);
    }
    expect(values.size).toBe(SAMPLES);
  });

  it('keeps session and receipt numbers distinguishable', () => {
    expect(newSessionNumber()).not.toMatch(RECEIPT_NUMBER_PATTERN);
    expect(newReceiptNumber(2026)).not.toMatch(SESSION_NUMBER_PATTERN);
  });
});
