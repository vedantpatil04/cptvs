import { Prisma } from '../generated/prisma/client.js';
import { prisma } from './prisma.js';

export interface TransactionOptions {
  /** Defaults to ReadCommitted. Use Serializable for allocation-style read-then-write logic. */
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeoutMs?: number;
}

/**
 * Runs `work` inside a single database transaction. Every repository call that
 * receives the provided `tx` client commits or rolls back together.
 */
export const withTransaction = <T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  {
    isolationLevel = Prisma.TransactionIsolationLevel.ReadCommitted,
    timeoutMs = 10_000,
  }: TransactionOptions = {},
): Promise<T> => prisma.$transaction(work, { isolationLevel, timeout: timeoutMs });
