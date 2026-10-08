import { describe, expect, it } from 'vitest';

import { parseEnv } from '../src/config/env.js';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv({ ...base });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      JWT_EXPIRES_IN_SECONDS: 28_800,
    });
  });

  it('parses and normalises CORS origins', () => {
    const env = parseEnv({
      ...base,
      CORS_ORIGINS: 'https://a.example/, https://b.example ,https://a.example',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it('rejects a short JWT secret', () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('requires an allowed origin in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
    expect(
      parseEnv({ ...base, NODE_ENV: 'production', FRONTEND_URL: 'https://cpvts.example' }),
    ).toBeTruthy();
  });
});
