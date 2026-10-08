/**
 * Environment for the test run. Integration tests use a real PostgreSQL
 * database: point TEST_DATABASE_URL at a disposable database — it is migrated
 * and truncated by the tests.
 */
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://cpvts:cpvts@localhost:5434/cpvts_test';

export const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: testDatabaseUrl,
  DIRECT_URL: testDatabaseUrl,
  JWT_SECRET: 'test-only-secret-that-is-at-least-32-characters-long',
  CORS_ORIGINS: 'http://localhost:5173',
  LOGIN_RATE_LIMIT_MAX: '1000',
  PUBLIC_RATE_LIMIT_PER_MINUTE: '1000',
  REGISTRATION_RATE_LIMIT_PER_HOUR: '1000',
} as const;
