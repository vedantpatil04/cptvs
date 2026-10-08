/**
 * Environment for the test run. Integration tests use a real PostgreSQL
 * database: point TEST_DATABASE_URL at a disposable database — it is migrated
 * and truncated by the tests.
 *
 * The shared development database (Supabase) must never be the test database:
 * the suite truncates every table. The guard below refuses to start unless the
 * URL points at a local or CI database whose name says it is for tests.
 */
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://cpvts:cpvts@localhost:5432/cpvts_test';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres', 'db']);

/** Throws unless `url` is a disposable test database that is safe to truncate. */
export const assertSafeTestDatabase = (url: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid database URL.');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const isRemoteProvider = /supabase|pooler|amazonaws|neon\.tech|render\.com/i.test(
    parsed.hostname,
  );
  if (isRemoteProvider || !LOCAL_HOSTS.has(parsed.hostname) || !/test/i.test(database)) {
    throw new Error(
      `Refusing to run the test suite against "${parsed.hostname}/${database}". The tests truncate ` +
        'every table, so TEST_DATABASE_URL must be a local (or CI) database whose name contains ' +
        '"test" — never the shared development database.',
    );
  }
};

assertSafeTestDatabase(testDatabaseUrl);

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
