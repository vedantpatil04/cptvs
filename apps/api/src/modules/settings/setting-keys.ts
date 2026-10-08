/** Keys of rows in the `settings` table. */
export const SETTING_KEYS = {
  /** Official parking fee rules (`FeeSchedule` in @cpvts/shared). */
  feeSchedule: 'parking.feeSchedule',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
