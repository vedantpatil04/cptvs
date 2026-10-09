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
