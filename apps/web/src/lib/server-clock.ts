/**
 * The device clock can be wrong (or in another time zone setting), but a parking timer must
 * count from the server's authoritative entry instant. Every API response carries a `Date`
 * header; the difference to the device clock is kept here and applied by `serverNow()`.
 */
let offsetMs = 0;

/** Responses slower than this (e.g. a free-tier host waking up) say little about the clock. */
const MAX_ROUND_TRIP_MS = 5_000;

/** Current server time in epoch milliseconds, corrected for the device clock offset. */
export const serverNow = (): number => Date.now() + offsetMs;

/**
 * Updates the offset from a response's `Date` header. The header has one-second resolution
 * (truncated), and the server stamped it about halfway through the round trip.
 */
export const syncServerClock = (
  dateHeader: string | null,
  sentAt: number,
  receivedAt: number,
): void => {
  if (!dateHeader || receivedAt - sentAt > MAX_ROUND_TRIP_MS) return;
  const serverTime = Date.parse(dateHeader);
  if (Number.isNaN(serverTime)) return;
  offsetMs = serverTime + 500 - (sentAt + (receivedAt - sentAt) / 2);
};

/** Test helper: forget any learned offset. */
export const resetServerClock = (): void => {
  offsetMs = 0;
};
