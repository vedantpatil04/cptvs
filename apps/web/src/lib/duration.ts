import { appConfig } from '@/config/env';

/** Whole seconds between the session's entry instant and `nowMs`; never negative. */
export const elapsedSeconds = (entryAt: string | Date, nowMs: number): number => {
  const start = typeof entryAt === 'string' ? Date.parse(entryAt) : entryAt.getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((nowMs - start) / 1000));
};

const pad = (value: number): string => String(value).padStart(2, '0');

/** `HH:MM:SS`; hours keep counting past 24 (a session that runs overnight shows 26:05:09). */
export const formatClock = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
};

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** The campus calendar date (YYYY-MM-DD) at `nowMs`. */
export const campusDateAt = (nowMs: number, timeZone = appConfig.campusTimeZone): string => {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter.format(nowMs);
};

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

const campusParts = (ms: number, timeZone: string) => {
  let formatter = partsFormatters.get(timeZone);
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
    partsFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(ms)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  return parts;
};

/** An instant as `YYYY-MM-DDTHH:mm` on the campus clock (for datetime-local inputs). */
export const isoToCampusLocal = (iso: string, timeZone = appConfig.campusTimeZone): string => {
  const p = campusParts(Date.parse(iso), timeZone);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
};

/** The instant at which the campus clock reads `YYYY-MM-DDTHH:mm` (inverse of the above). */
export const campusLocalToIso = (local: string, timeZone = appConfig.campusTimeZone): string => {
  const [date = '', time = ''] = local.split('T');
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  // Offset of the zone from UTC at an instant: what the zone's clock shows minus the instant.
  const offsetAt = (ms: number): number => {
    const p = campusParts(ms, timeZone);
    return (
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
      Math.floor(ms / 1000) * 1000
    );
  };
  // Two passes settle the offset even across a daylight-saving change.
  const first = wanted - offsetAt(wanted);
  return new Date(wanted - offsetAt(first)).toISOString();
};

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

/** The campus clock hour (0-23) at `nowMs`, the hour the fee rules are measured in. */
export const campusHourAt = (nowMs: number, timeZone = appConfig.campusTimeZone): number => {
  let formatter = hourFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
    hourFormatters.set(timeZone, formatter);
  }
  return Number(formatter.format(nowMs));
};
