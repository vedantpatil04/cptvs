import { describe, expect, it } from 'vitest';

import { joinUrl } from '@/lib/api-client';
import { normalizeApiRoot } from './env';

describe('normalizeApiRoot', () => {
  it('strips trailing slashes from origin URL', () => {
    expect(normalizeApiRoot('https://cpvts-api.onrender.com/')).toBe(
      'https://cpvts-api.onrender.com',
    );
    expect(normalizeApiRoot('https://cpvts-api.onrender.com///')).toBe(
      'https://cpvts-api.onrender.com',
    );
  });

  it('strips /api/v1 suffix if mistakenly included in base URL', () => {
    expect(normalizeApiRoot('https://cpvts-api.onrender.com/api/v1')).toBe(
      'https://cpvts-api.onrender.com',
    );
    expect(normalizeApiRoot('https://cpvts-api.onrender.com/api/v1/')).toBe(
      'https://cpvts-api.onrender.com',
    );
  });

  it('strips /api suffix if mistakenly included in base URL', () => {
    expect(normalizeApiRoot('https://cpvts-api.onrender.com/api')).toBe(
      'https://cpvts-api.onrender.com',
    );
    expect(normalizeApiRoot('https://cpvts-api.onrender.com/api/')).toBe(
      'https://cpvts-api.onrender.com',
    );
  });

  it('handles empty or undefined values gracefully', () => {
    expect(normalizeApiRoot('')).toBe('');
    expect(normalizeApiRoot(undefined)).toBe('');
  });
});

describe('joinUrl', () => {
  it('joins base URL and endpoint without duplicate or missing slashes', () => {
    expect(joinUrl('https://cpvts-api.onrender.com/api/v1', '/portal/overview')).toBe(
      'https://cpvts-api.onrender.com/api/v1/portal/overview',
    );
    expect(joinUrl('https://cpvts-api.onrender.com/api/v1/', '/portal/overview')).toBe(
      'https://cpvts-api.onrender.com/api/v1/portal/overview',
    );
    expect(joinUrl('https://cpvts-api.onrender.com/api/v1', 'portal/overview')).toBe(
      'https://cpvts-api.onrender.com/api/v1/portal/overview',
    );
  });
});
