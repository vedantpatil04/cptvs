import { readFileSync } from 'node:fs';

import { parseEnv, type Env } from './env.js';

const DEFAULT_DEV_ORIGIN = 'http://localhost:5173';

const readPackageVersion = (): string => {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
};

const resolveCorsOrigins = (env: Env): string[] => {
  if (env.CORS_ORIGINS?.length) return env.CORS_ORIGINS;
  if (env.FRONTEND_URL) return [env.FRONTEND_URL.replace(/\/+$/, '')];
  return env.NODE_ENV === 'production' ? [] : [DEFAULT_DEV_ORIGIN];
};

export const buildConfig = (env: Env) =>
  Object.freeze({
    nodeEnv: env.NODE_ENV,
    appEnv: env.APP_ENV ?? env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    version: readPackageVersion(),
    server: Object.freeze({
      host: env.HOST,
      port: env.PORT,
      trustProxy: env.TRUST_PROXY,
    }),
    database: Object.freeze({
      url: env.DATABASE_URL,
    }),
    jwt: Object.freeze({
      secret: env.JWT_SECRET,
      expiresInSeconds: env.JWT_EXPIRES_IN_SECONDS,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }),
    parking: Object.freeze({
      timeZone: env.CAMPUS_TIMEZONE,
      slotHoldMs: env.SLOT_HOLD_SECONDS * 1000,
    }),
    alerts: Object.freeze({
      nearlyFullPercent: env.ALERT_NEARLY_FULL_PERCENT,
      longDurationHours: env.ALERT_LONG_DURATION_HOURS,
    }),
    accounts: Object.freeze({
      emailDomains: Object.freeze(env.INSTITUTION_EMAIL_DOMAINS ?? []),
      visitorAccessSeconds: env.VISITOR_ACCESS_HOURS * 3600,
    }),
    cors: Object.freeze({
      origins: Object.freeze(resolveCorsOrigins(env)),
    }),
    rateLimit: Object.freeze({
      login: Object.freeze({
        windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60_000,
        max: env.LOGIN_RATE_LIMIT_MAX,
      }),
      public: Object.freeze({
        maxPerMinute: env.PUBLIC_RATE_LIMIT_PER_MINUTE,
      }),
      registrationPerHour: env.REGISTRATION_RATE_LIMIT_PER_HOUR,
    }),
  });

export type AppConfig = ReturnType<typeof buildConfig>;

/** Validated, immutable application configuration. Fails fast on startup if invalid. */
export const config: AppConfig = buildConfig(parseEnv(process.env));
