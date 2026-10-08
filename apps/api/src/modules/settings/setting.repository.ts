import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { SettingKey } from './setting-keys.js';

export const settingRepository = {
  /** Returns the stored JSON value, or null when the setting does not exist. */
  async getValue(key: SettingKey, db: DbClient = prisma): Promise<unknown> {
    const setting = await db.setting.findUnique({ where: { key }, select: { value: true } });
    return setting?.value ?? null;
  },

  /** Creates the setting only if it does not exist yet. Returns true when created. */
  async createIfAbsent(
    key: SettingKey,
    value: Prisma.InputJsonValue,
    description: string,
    db: DbClient = prisma,
  ): Promise<boolean> {
    const result = await db.setting.createMany({
      data: [{ key, value, description }],
      skipDuplicates: true,
    });
    return result.count === 1;
  },
};
