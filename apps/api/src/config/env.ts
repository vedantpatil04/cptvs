import { z } from 'zod';

const NODE_ENVS = ['development', 'test', 'production'] as const;

/** Parses a comma-separated list of origins into a de-duplicated array. */
const originList = z
  .string()
  .transform((value) =>
    [...new Set(value.split(',').map((origin) => origin.trim().replace(/\/+$/, '')))].filter(
      Boolean,
    ),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })));

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
    /** Requests per minute per IP allowed on unauthenticated public endpoints. */
    PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(120),
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
