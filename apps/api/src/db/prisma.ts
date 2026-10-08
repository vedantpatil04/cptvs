import { PrismaPg } from '@prisma/adapter-pg';

import { config } from '../config/index.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * The single PrismaClient for the process. This module and the rest of `db/`
 * are the only places that know about the database provider; the rest of the
 * application depends on repositories.
 */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.database.url }),
});

export const disconnectDatabase = (): Promise<void> => prisma.$disconnect();

/** Round-trips a trivial query. Returns latency in milliseconds, or null if unreachable. */
export const pingDatabase = async (): Promise<number | null> => {
  const startedAt = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Math.round(performance.now() - startedAt);
  } catch {
    return null;
  }
};
