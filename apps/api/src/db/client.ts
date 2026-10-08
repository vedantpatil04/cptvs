import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/**
 * Either the root client or an interactive-transaction client. Repositories
 * accept this so that services can compose several repository calls into one
 * atomic unit of work via `withTransaction`.
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;
