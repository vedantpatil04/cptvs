import type { UserRole } from '@cpvts/shared';

import { prisma } from '../src/db/prisma.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { userRepository } from '../src/modules/users/user.repository.js';

export const TEST_PASSWORD = 'correct-horse-battery';

/**
 * Removes all rows from every application table. Defence in depth: the target database is
 * checked by name first, so a misconfigured URL can never truncate a real database.
 */
export const resetDatabase = async (): Promise<void> => {
  const rows = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  const name = rows[0]?.name;
  if (!name || !/test/i.test(name)) {
    throw new Error(
      `Refusing to truncate "${name}": the test database must have "test" in its name.`,
    );
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE notifications, park_now_offers, cash_handovers, receipts, payments, security_shifts, shift_templates, parking_sessions, parking_slots, parking_zones, parking_blocks, vehicles, identity_documents, parking_user_profiles, audit_logs, settings, users RESTART IDENTITY CASCADE',
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
