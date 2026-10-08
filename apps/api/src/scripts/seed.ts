/**
 * Idempotent seed: creates the initial Admin and (optionally) Security Staff
 * accounts from environment variables. Existing accounts are never modified.
 *
 *   SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD / SEED_ADMIN_FULL_NAME
 *   SEED_STAFF_USERNAME / SEED_STAFF_PASSWORD / SEED_STAFF_FULL_NAME
 *
 * Development: `npm run db:seed` (TypeScript via tsx).
 * Production:  `npm run db:seed:deploy` (compiled JavaScript, no dev dependencies).
 * No parking layout or demo data is seeded in Phase 1.
 */
import { normalizeUsername, passwordPolicySchema, type UserRole } from '@cpvts/shared';

import { disconnectDatabase } from '../db/prisma.js';
import { hashPassword } from '../modules/auth/password.js';
import { userRepository } from '../modules/users/user.repository.js';

interface SeedAccount {
  label: string;
  role: UserRole;
  prefix: 'SEED_ADMIN' | 'SEED_STAFF';
  required: boolean;
}

const ACCOUNTS: SeedAccount[] = [
  { label: 'Admin', role: 'ADMIN', prefix: 'SEED_ADMIN', required: true },
  { label: 'Security Staff', role: 'SECURITY_STAFF', prefix: 'SEED_STAFF', required: false },
];

const seedAccount = async ({ label, role, prefix, required }: SeedAccount): Promise<void> => {
  const rawUsername = process.env[`${prefix}_USERNAME`];
  const password = process.env[`${prefix}_PASSWORD`];
  const fullName = process.env[`${prefix}_FULL_NAME`]?.trim() || label;

  if (!rawUsername || !password) {
    if (required) {
      throw new Error(
        `${prefix}_USERNAME and ${prefix}_PASSWORD must be set to seed the ${label} account.`,
      );
    }
    console.info(`- ${label}: skipped (${prefix}_USERNAME / ${prefix}_PASSWORD not set)`);
    return;
  }

  const username = normalizeUsername(rawUsername);
  if (await userRepository.findByUsername(username)) {
    console.info(`- ${label}: "${username}" already exists, left unchanged`);
    return;
  }

  const policy = passwordPolicySchema.safeParse(password);
  if (!policy.success) {
    throw new Error(
      `${prefix}_PASSWORD does not meet the password policy (${policy.error.issues[0]?.message}).`,
    );
  }

  await userRepository.create({
    username,
    fullName,
    role,
    passwordHash: await hashPassword(password),
  });
  console.info(`- ${label}: created "${username}"`);
};

try {
  console.info('Seeding CPVTS accounts…');
  for (const account of ACCOUNTS) await seedAccount(account);
  console.info('Seed complete.');
} catch (error) {
  console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
