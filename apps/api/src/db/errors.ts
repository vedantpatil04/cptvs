import { Prisma } from '../generated/prisma/client.js';

/**
 * True when `error` is a unique-constraint violation of the named index or
 * constraint. The database is the final guard against races (e.g. two
 * terminals checking in the same vehicle at the same moment).
 */
export const isUniqueViolation = (error: unknown, constraint: string): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002' &&
  JSON.stringify(error.meta ?? {}).includes(constraint);
