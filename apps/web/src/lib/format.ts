/** Whole-hour times as shown throughout CPVTS, e.g. 9 → "09:00". */
export const formatHour = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

/** All 24 hours, for hour pickers. */
export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
