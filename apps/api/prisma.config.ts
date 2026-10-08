import { existsSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

// The Prisma CLI does not load .env files itself. Load a local .env when one
// exists; hosted environments (Render, CI, Docker) inject variables directly.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/**
 * Migrations need a direct (or session-mode pooled) connection. When the app
 * runs through a transaction-mode pooler (e.g. Supabase port 6543), set
 * DIRECT_URL for the CLI; otherwise DATABASE_URL is used.
 * `prisma generate` does not connect, so the URL may be absent at build time.
 */
const migrationUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/scripts/seed.ts',
  },
  ...(migrationUrl ? { datasource: { url: migrationUrl } } : {}),
});
