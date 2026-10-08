import { z } from 'zod';

const NODE_ENVS = ['development', 'test', 'production'] as const;

const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
};

/** Parses a comma-separated list of origins into a de-duplicated array. */
const originList = z
  .string()
  .transform((value) =>
    [...new Set(value.split(',').map((origin) => origin.trim().replace(/\/+$/, '')))].filter(
      Boolean,
    ),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })));

/** Comma-separated e-mail domains, e.g. `college.edu.in,staff.college.edu.in`. */
const domainList = z
  .string()
  .transform((value) =>
    [...new Set(value.split(',').map((domain) => domain.trim().toLowerCase()))].filter(Boolean),
  )
  .pipe(z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Invalid e-mail domain')));

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),
    /** Human-readable environment name, e.g. `staging`. Defaults to NODE_ENV. */
    APP_ENV: z.string().trim().min(1).max(32).optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().trim().min(1).default('0.0.0.0'),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    /** Access-token lifetime in seconds (default 8 hours — one security shift). */
    JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().min(60).max(86_400).default(28_800),
    JWT_ISSUER: z.string().trim().min(1).default('cpvts-api'),
    JWT_AUDIENCE: z.string().trim().min(1).default('cpvts-web'),

    /** Public URL of the web app. Used as the default CORS origin. */
    FRONTEND_URL: z.url({ protocol: /^https?$/ }).optional(),
    /** Comma-separated list of allowed browser origins. */
    CORS_ORIGINS: originList.optional(),

    /** Express `trust proxy` setting: number of trusted reverse-proxy hops. */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(10),
    /** IANA time zone of the campus; defines "today" and the current hour. */
    CAMPUS_TIMEZONE: z
      .string()
      .trim()
      .default('Asia/Kolkata')
      .refine(isValidTimeZone, 'CAMPUS_TIMEZONE must be a valid IANA time zone'),
    /** Lifetime of a temporary slot hold during allocation, in seconds. */
    SLOT_HOLD_SECONDS: z.coerce.number().int().min(2).max(120).default(15),
    /**
     * How long a Park Now allocation stays held while the user reads it and
     * confirms, in seconds. After that the slot returns to the pool.
     */
    PARK_NOW_HOLD_SECONDS: z.coerce.number().int().min(10).max(600).default(90),
    /** A zone at or above this occupancy (percent of usable slots) raises a warning. */
    ALERT_NEARLY_FULL_PERCENT: z.coerce.number().int().min(50).max(99).default(90),
    /** An active session parked at least this many hours raises a long-duration alert. */
    ALERT_LONG_DURATION_HOURS: z.coerce.number().int().min(1).max(23).default(8),
    /** Requests per minute per IP allowed on unauthenticated public endpoints. */
    PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(120),
    /**
     * When set, Student / Campus Staff registration requires an e-mail address
     * at one of these domains (or their subdomains). Empty allows any address.
     */
    INSTITUTION_EMAIL_DOMAINS: domainList.optional(),
    /** Registrations allowed per IP per hour. */
    REGISTRATION_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(10),
    /** Lifetime of a visitor's access to one parking session, in hours. */
    VISITOR_ACCESS_HOURS: z.coerce.number().int().min(1).max(48).default(12),
    /**
     * `required`: Security Staff need a checked-in shift for gate operations (vehicle entry,
     * checkout payments). `optional`: they may work without one, and what they do is still
     * attributed to their shift when they have one. Administrators can always act (override).
     */
    SHIFT_ENFORCEMENT: z.enum(['required', 'optional']).default('required'),
    /** Minutes before a shift starts that its Security Staff member may check in. */
    SHIFT_EARLY_CHECK_IN_MINUTES: z.coerce.number().int().min(0).max(240).default(60),
    /** Minutes after a shift's end during which the guard can still finish at the gate. */
    SHIFT_OVERRUN_MINUTES: z.coerce.number().int().min(0).max(240).default(30),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.CORS_ORIGINS?.length && !env.FRONTEND_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS or FRONTEND_URL must be set in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export const parseEnv = (source: NodeJS.ProcessEnv): Env => {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
};
