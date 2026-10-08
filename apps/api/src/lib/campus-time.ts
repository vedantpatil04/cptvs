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
