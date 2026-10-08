import { feeScheduleSchema, type FeeSchedule } from '@cpvts/shared';

/**
 * Official CPVTS fee rules (Master Blueprint §16), amounts in paise.
 * Seeded into the `settings` table; the fee engine always reads the stored
 * schedule, never this constant.
 */
export const OFFICIAL_FEE_SCHEDULE: FeeSchedule = feeScheduleSchema.parse({
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
