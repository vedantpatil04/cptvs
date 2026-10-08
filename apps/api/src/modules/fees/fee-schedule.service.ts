import { feeScheduleSchema, type FeeSchedule } from '@cpvts/shared';

import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { SETTING_KEYS } from '../settings/setting-keys.js';
import { settingRepository } from '../settings/setting.repository.js';

/** Reads the configured fee schedule (settings table). The only source of fee rules. */
export const feeScheduleService = {
  /** Null when not configured or invalid (an invalid value is logged, never used). */
  async find(): Promise<FeeSchedule | null> {
    const value = await settingRepository.getValue(SETTING_KEYS.feeSchedule);
    if (value === null) return null;
    const parsed = feeScheduleSchema.safeParse(value);
    if (!parsed.success) {
      logger.warn('stored fee schedule is invalid and will not be used', {
        key: SETTING_KEYS.feeSchedule,
      });
      return null;
    }
    return parsed.data;
  },

  async require(): Promise<FeeSchedule> {
    const schedule = await this.find();
    if (!schedule) {
      throw new AppError(
        503,
        'FEE_SCHEDULE_NOT_CONFIGURED',
        'Parking fees have not been configured. Contact an administrator.',
      );
    }
    return schedule;
  },
};
