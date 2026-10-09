import { config } from '../config/index.js';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

const zonedParts = (date: Date, timeZone: string): ZonedParts => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as unknown as ZonedParts;
  return parts;
};

/** Offset of `timeZone` from UTC at `date`, in milliseconds. */
const offsetMs = (date: Date, timeZone: string): number => {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (date.getTime() - date.getMilliseconds());
};

/** Current hour (0–23) on campus. Used for live durations and estimates. */
export const campusHour = (now = new Date(), timeZone = config.parking.timeZone): number =>
  zonedParts(now, timeZone).hour;

/** Calendar year on campus (used in receipt numbers). */
export const campusYear = (now = new Date(), timeZone = config.parking.timeZone): number =>
  zonedParts(now, timeZone).year;

/** The instant the current campus day began ("today" for dashboards). */
export const campusDayStart = (now = new Date(), timeZone = config.parking.timeZone): Date => {
  const p = zonedParts(now, timeZone);
  const localMidnightAsUtc = Date.UTC(p.year, p.month - 1, p.day);
  const firstGuess = localMidnightAsUtc - offsetMs(now, timeZone);
  return new Date(localMidnightAsUtc - offsetMs(new Date(firstGuess), timeZone));
};

/**
 * The instant at which the campus clock reads `minuteOfDay` (0–1439) on the campus calendar
 * date `date` (YYYY-MM-DD). Shifts use it to turn "08:00 on 2026-10-09" into a real instant.
 */
export const campusInstant = (
  date: string,
  minuteOfDay: number,
  timeZone = config.parking.timeZone,
): Date => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const localAsUtc = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const firstGuess = localAsUtc - offsetMs(new Date(localAsUtc), timeZone);
  return new Date(localAsUtc - offsetMs(new Date(firstGuess), timeZone));
};

/** Campus calendar date (YYYY-MM-DD) of an instant. */
export const campusDateString = (date = new Date(), timeZone = config.parking.timeZone): string => {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

/** The instant a campus calendar date (YYYY-MM-DD) begins. */
export const campusDateStart = (date: string, timeZone = config.parking.timeZone): Date => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  // Noon on that date is safely inside it; take its campus day start.
  return campusDayStart(new Date(Date.UTC(year, month - 1, day, 12)), timeZone);
};

const DAY_MS = 86_400_000;

/** The campus date `days` after `date` (negative for earlier). */
export const addCampusDays = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
};

/** Number of calendar days from `from` to `to`, inclusive. */
export const campusDaysInclusive = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/** Campus local date and time, e.g. "2026-10-08 17:05" (for exports). */
export const campusDateTimeString = (date: Date, timeZone = config.parking.timeZone): string => {
  const p = zonedParts(date, timeZone);
  return `${campusDateString(date, timeZone)} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};
