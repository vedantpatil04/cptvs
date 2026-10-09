import type { FeeSchedule } from '@cpvts/shared';
import { describe, expect, it } from 'vitest';

import { AppError } from '../src/lib/errors.js';
import { calculateDurationHours, calculateFee } from '../src/modules/fees/fee-engine.js';
import { OFFICIAL_FEE_SCHEDULE } from './parking-helpers.js';

const schedule: FeeSchedule = OFFICIAL_FEE_SCHEDULE;

describe('calculateDurationHours (whole-hour model)', () => {
  it('is exit hour minus entry hour', () => {
    expect(calculateDurationHours(9, 13)).toBe(4);
    expect(calculateDurationHours(0, 23)).toBe(23);
    expect(calculateDurationHours(10, 10)).toBe(0);
  });

  it('rejects an exit hour earlier than the entry hour', () => {
    expect(() => calculateDurationHours(13, 9)).toThrow(AppError);
    try {
      calculateDurationHours(13, 9);
    } catch (error) {
      expect((error as AppError).code).toBe('EXIT_BEFORE_ENTRY');
    }
  });

  it('rejects fractional hours', () => {
    expect(() => calculateDurationHours(9.5, 13)).toThrow(AppError);
  });
});

describe('calculateFee (official pricing)', () => {
  it('official example: Student two-wheeler 09:00–13:00 = ₹20', () => {
    const fee = calculateFee(schedule, 'STUDENT', 'TWO_WHEELER', calculateDurationHours(9, 13));
    expect(fee.totalPaise).toBe(2_000);
    expect(fee.lines).toEqual([
      { kind: 'FREE', hours: 2 },
      { kind: 'CHARGED', hours: 2, ratePaise: 1_000, amountPaise: 2_000 },
    ]);
  });

  it.each([
    ['STAFF', 'TWO_WHEELER', 5, 0],
    ['STAFF', 'FOUR_WHEELER', 8, 0],
    ['STUDENT', 'TWO_WHEELER', 1, 0],
    ['STUDENT', 'TWO_WHEELER', 2, 0],
    ['STUDENT', 'TWO_WHEELER', 3, 1_000],
    ['STUDENT', 'FOUR_WHEELER', 2, 0],
    ['STUDENT', 'FOUR_WHEELER', 5, 6_000],
    ['VISITOR', 'TWO_WHEELER', 1, 2_000],
    ['VISITOR', 'TWO_WHEELER', 3, 6_000],
    ['VISITOR', 'FOUR_WHEELER', 2, 8_000],
    ['VISITOR', 'FOUR_WHEELER', 0, 0],
  ] as const)('%s %s for %i h = %i paise', (category, vehicleType, hours, expected) => {
    expect(calculateFee(schedule, category, vehicleType, hours).totalPaise).toBe(expected);
  });

  it('records the applied rule and duration for transparency', () => {
    const fee = calculateFee(schedule, 'VISITOR', 'FOUR_WHEELER', 3);
    expect(fee).toMatchObject({
      ownerCategory: 'VISITOR',
      vehicleType: 'FOUR_WHEELER',
      durationHours: 3,
      rule: { type: 'HOURLY', hourlyRatePaise: 4_000 },
      lines: [{ kind: 'CHARGED', hours: 3, ratePaise: 4_000, amountPaise: 12_000 }],
    });
  });

  it('rejects negative or fractional durations', () => {
    expect(() => calculateFee(schedule, 'STAFF', 'TWO_WHEELER', -1)).toThrow(AppError);
    expect(() => calculateFee(schedule, 'STAFF', 'TWO_WHEELER', 1.5)).toThrow(AppError);
  });
});

describe('fee boundaries (whole-hour model)', () => {
  it('exactly two hours is free for students, the third hour is the first charged one', () => {
    expect(calculateFee(schedule, 'STUDENT', 'TWO_WHEELER', 2).totalPaise).toBe(0);
    expect(calculateFee(schedule, 'STUDENT', 'FOUR_WHEELER', 2).totalPaise).toBe(0);
    expect(calculateFee(schedule, 'STUDENT', 'TWO_WHEELER', 3).totalPaise).toBe(1_000);
    expect(calculateFee(schedule, 'STUDENT', 'FOUR_WHEELER', 3).totalPaise).toBe(2_000);
  });

  it('a zero-hour stay costs nothing for every category', () => {
    for (const category of ['STAFF', 'STUDENT', 'VISITOR'] as const) {
      for (const type of ['TWO_WHEELER', 'FOUR_WHEELER'] as const) {
        expect(calculateFee(schedule, category, type, 0).totalPaise, `${category} ${type}`).toBe(0);
      }
    }
  });

  it('staff always park free, however long', () => {
    expect(calculateFee(schedule, 'STAFF', 'TWO_WHEELER', 23).totalPaise).toBe(0);
    expect(calculateFee(schedule, 'STAFF', 'FOUR_WHEELER', 23).totalPaise).toBe(0);
  });

  it('visitors pay from the first hour: ₹20 per hour on two wheels, ₹40 on four', () => {
    expect(calculateFee(schedule, 'VISITOR', 'TWO_WHEELER', 1).totalPaise).toBe(2_000);
    expect(calculateFee(schedule, 'VISITOR', 'FOUR_WHEELER', 1).totalPaise).toBe(4_000);
    expect(calculateFee(schedule, 'VISITOR', 'TWO_WHEELER', 23).totalPaise).toBe(46_000);
    expect(calculateFee(schedule, 'VISITOR', 'FOUR_WHEELER', 23).totalPaise).toBe(92_000);
  });

  it('prices the longest same-day stay (00:00 to 23:00)', () => {
    const hours = calculateDurationHours(0, 23);
    expect(calculateFee(schedule, 'STUDENT', 'TWO_WHEELER', hours).totalPaise).toBe(21_000);
  });

  it('KNOWN LIMITATION: a stay across midnight cannot be priced, it is refused', () => {
    // The competition model measures hours on the 0-23 clock of one day, so an exit hour
    // earlier than the entry hour (a stay that crossed midnight) is rejected rather than
    // silently priced as a short stay. Changing this is a fee-policy decision, not a fix.
    for (const [entry, exit] of [
      [22, 2],
      [23, 0],
      [18, 6],
    ] as const) {
      try {
        calculateDurationHours(entry, exit);
        expect.unreachable('expected EXIT_BEFORE_ENTRY');
      } catch (error) {
        expect((error as AppError).code).toBe('EXIT_BEFORE_ENTRY');
      }
    }
  });
});
