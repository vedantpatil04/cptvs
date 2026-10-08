import type { UserRole } from '@cpvts/shared';

import { prisma } from '../src/db/prisma.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { userRepository } from '../src/modules/users/user.repository.js';

export const TEST_PASSWORD = 'correct-horse-battery';

/** Removes all rows from every application table. */
export const resetDatabase = async (): Promise<void> => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE receipts, payments, parking_sessions, parking_slots, parking_zones, parking_blocks, vehicles, audit_logs, settings, users RESTART IDENTITY CASCADE',
  );
};

let cachedHash: string | undefined;

export const createUser = async (
  role: UserRole,
  username: string,
  overrides: { isActive?: boolean } = {},
) => {
  cachedHash ??= await hashPassword(TEST_PASSWORD);
  const user = await userRepository.create({
    username,
    fullName: `${role} user`,
    role,
    passwordHash: cachedHash,
  });
  if (overrides.isActive === false) {
    return prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
  }
  return user;
};
