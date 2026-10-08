/**
 * Idempotent seed. Existing data is never modified.
 *
 * 1. Initial Admin and (optionally) Security Staff accounts from environment variables:
 *      SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD / SEED_ADMIN_FULL_NAME
 *      SEED_STAFF_USERNAME / SEED_STAFF_PASSWORD / SEED_STAFF_FULL_NAME
 * 2. The minimum parking layout from Master Blueprint §5 (T-01…T-10, F-01…F-05,
 *    all AVAILABLE) — only when no parking block exists yet. GPS coordinates are
 *    left empty: real coordinates must be collected, never invented (§7).
 * 3. The official fee schedule (Master Blueprint §16) — only if not configured.
 *
 * Development: `npm run db:seed` (TypeScript via tsx).
 * Production:  `npm run db:seed:deploy` (compiled JavaScript, no dev dependencies).
 * No vehicles, sessions, payments or other demo data are created.
 */
import {
  feeScheduleSchema,
  normalizeUsername,
  passwordPolicySchema,
  type FeeSchedule,
  type UserRole,
  type VehicleType,
} from '@cpvts/shared';

import { disconnectDatabase, prisma } from '../db/prisma.js';
import { withTransaction } from '../db/transaction.js';
import { hashPassword } from '../modules/auth/password.js';
import { SETTING_KEYS } from '../modules/settings/setting-keys.js';
import { settingRepository } from '../modules/settings/setting.repository.js';
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

interface BaselineBlock {
  code: string;
  name: string;
  vehicleType: VehicleType;
  zoneCode: string;
  zoneName: string;
  slotPrefix: string;
  slotCount: number;
}

/** Minimum required layout (Master Blueprint §5). */
const BASELINE_LAYOUT: BaselineBlock[] = [
  {
    code: 'BLOCK-2W',
    name: 'Two-Wheeler Parking Block',
    vehicleType: 'TWO_WHEELER',
    zoneCode: 'ZONE-2W',
    zoneName: 'Two-Wheeler Zone',
    slotPrefix: 'T',
    slotCount: 10,
  },
  {
    code: 'BLOCK-4W',
    name: 'Four-Wheeler Parking Block',
    vehicleType: 'FOUR_WHEELER',
    zoneCode: 'ZONE-4W',
    zoneName: 'Four-Wheeler Zone',
    slotPrefix: 'F',
    slotCount: 5,
  },
];

/** Official fee rules (Master Blueprint §16). Amounts in paise. */
const OFFICIAL_FEE_SCHEDULE: FeeSchedule = feeScheduleSchema.parse({
  currency: 'INR',
  rules: {
    STAFF: { TWO_WHEELER: { type: 'FREE' }, FOUR_WHEELER: { type: 'FREE' } },
    STUDENT: {
      TWO_WHEELER: { type: 'FREE_HOURS_THEN_HOURLY', freeHours: 2, hourlyRatePaise: 1_000 },
      FOUR_WHEELER: { type: 'FREE_HOURS_THEN_HOURLY', freeHours: 2, hourlyRatePaise: 2_000 },
    },
    VISITOR: {
      TWO_WHEELER: { type: 'HOURLY', hourlyRatePaise: 2_000 },
      FOUR_WHEELER: { type: 'HOURLY', hourlyRatePaise: 4_000 },
    },
  },
});

const seedParkingLayout = async (): Promise<void> => {
  if ((await prisma.parkingBlock.count()) > 0) {
    console.info('- Parking layout: blocks already configured, left unchanged');
    return;
  }

  await withTransaction(async (tx) => {
    for (const [blockIndex, block] of BASELINE_LAYOUT.entries()) {
      await tx.parkingBlock.create({
        data: {
          code: block.code,
          name: block.name,
          sortOrder: blockIndex,
          zones: {
            create: {
              code: block.zoneCode,
              name: block.zoneName,
              vehicleType: block.vehicleType,
              slots: {
                create: Array.from({ length: block.slotCount }, (_, slotIndex) => ({
                  code: `${block.slotPrefix}-${String(slotIndex + 1).padStart(2, '0')}`,
                  sortOrder: slotIndex,
                })),
              },
            },
          },
        },
      });
    }
  });
  const slots = BASELINE_LAYOUT.reduce((sum, block) => sum + block.slotCount, 0);
  console.info(`- Parking layout: created ${BASELINE_LAYOUT.length} blocks with ${slots} slots`);
};

const seedFeeSchedule = async (): Promise<void> => {
  const created = await settingRepository.createIfAbsent(
    SETTING_KEYS.feeSchedule,
    OFFICIAL_FEE_SCHEDULE,
    'Official parking fee rules by owner category and vehicle type (amounts in paise).',
  );
  console.info(
    created ? '- Fee schedule: created' : '- Fee schedule: already configured, left unchanged',
  );
};

try {
  console.info('Seeding CPVTS…');
  for (const account of ACCOUNTS) await seedAccount(account);
  await seedParkingLayout();
  await seedFeeSchedule();
  console.info('Seed complete.');
} catch (error) {
  console.error(`Seed failed: ${(error instanceof Error ? error.message : String(error)).trim()}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
