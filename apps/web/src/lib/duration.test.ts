import { afterEach, describe, expect, it } from 'vitest';

import { campusDateAt, campusHourAt, elapsedSeconds, formatClock } from './duration';
import { resetServerClock, serverNow, syncServerClock } from './server-clock';

describe('elapsedSeconds / formatClock', () => {
  const entry = '2026-10-09T04:30:00.000Z';
  const at = (offsetSeconds: number) => Date.parse(entry) + offsetSeconds * 1000;

  it('counts from the entry instant, to the second', () => {
    expect(elapsedSeconds(entry, at(0))).toBe(0);
    expect(elapsedSeconds(entry, at(59))).toBe(59);
    expect(elapsedSeconds(entry, at(3_599))).toBe(3_599);
    expect(elapsedSeconds(entry, at(7_200))).toBe(7_200);
  });

  it('is derived from the timestamp, so it survives any number of re-renders or remounts', () => {
    const now = at(8_130);
    expect(elapsedSeconds(entry, now)).toBe(elapsedSeconds(entry, now));
  });

  it('never goes negative when the clock is slightly behind the server', () => {
    expect(elapsedSeconds(entry, at(-5))).toBe(0);
  });

  it('formats HH:MM:SS', () => {
    expect(formatClock(0)).toBe('00:00:00');
    expect(formatClock(59)).toBe('00:00:59');
    expect(formatClock(3_600)).toBe('01:00:00');
    expect(formatClock(7_199)).toBe('01:59:59');
    expect(formatClock(7_200)).toBe('02:00:00');
  });

  it('keeps counting hours across midnight instead of wrapping', () => {
    // 22:00 to 02:05:09 the next day = 4 h 5 min 9 s; a 26 h session shows 26:05:09.
    expect(formatClock(4 * 3_600 + 5 * 60 + 9)).toBe('04:05:09');
    expect(formatClock(26 * 3_600 + 5 * 60 + 9)).toBe('26:05:09');
  });
});

describe('campus clock', () => {
  it('reads the hour and date in the campus time zone, not the device time zone', () => {
    // 2026-10-09 18:30 UTC is 00:00 on 10 October in India (UTC+5:30).
    const instant = Date.parse('2026-10-09T18:30:00Z');
    expect(campusHourAt(instant, 'Asia/Kolkata')).toBe(0);
    expect(campusDateAt(instant, 'Asia/Kolkata')).toBe('2026-10-10');
    expect(campusHourAt(instant - 1_000, 'Asia/Kolkata')).toBe(23);
    expect(campusDateAt(instant - 1_000, 'Asia/Kolkata')).toBe('2026-10-09');
    expect(campusHourAt(instant, 'UTC')).toBe(18);
  });
});

describe('server clock', () => {
  afterEach(resetServerClock);

  it('corrects for a device clock that runs behind the server', () => {
    const sent = Date.now();
    // The server says it is 10 minutes later than this device.
    const serverTime = new Date(sent + 600_000);
    syncServerClock(serverTime.toUTCString(), sent, sent);
    expect(serverNow() - Date.now()).toBeGreaterThan(590_000);
    expect(serverNow() - Date.now()).toBeLessThan(610_000);
  });

  it('ignores missing or malformed headers and very slow responses', () => {
    syncServerClock(null, 0, 10);
    syncServerClock('not a date', 0, 10);
    syncServerClock(new Date(Date.now() + 3_600_000).toUTCString(), 0, 60_000);
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(50);
  });
});
