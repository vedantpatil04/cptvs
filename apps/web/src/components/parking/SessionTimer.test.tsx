import type { FeeBreakdown, ParkingSessionView } from '@cpvts/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { resetServerClock } from '@/lib/server-clock';

import { SessionTimer } from './SessionTimer';

const fee = (totalPaise: number): FeeBreakdown => ({
  ownerCategory: 'STUDENT',
  vehicleType: 'TWO_WHEELER',
  durationHours: 2,
  rule: { type: 'FREE_HOURS_THEN_HOURLY', freeHours: 2, hourlyRatePaise: 1000 },
  lines: [{ kind: 'FREE', hours: 2 }],
  totalPaise,
});

// Entered 10:00 IST (04:30 UTC).
const active: ParkingSessionView = {
  sessionNumber: 'CPVTS-P-7K4M92QX',
  status: 'ACTIVE',
  lifecycle: 'ACTIVE',
  exitRequestedAt: null,
  vehicleNumber: 'KA22AB1234',
  vehicleType: 'TWO_WHEELER',
  ownerCategory: 'STUDENT',
  block: { code: 'BLOCK-2W', name: 'Two-Wheeler Parking Block', coordinates: null },
  zone: { code: 'ZONE-2W', name: 'Two-Wheeler Zone' },
  slotCode: 'T-04',
  entryHour: 10,
  entryAt: '2026-10-09T04:30:00.000Z',
  entryReference: 'A'.repeat(43),
  currentHour: 12,
  currentDurationHours: 2,
  estimatedFee: fee(0),
  exitHour: null,
  exitAt: null,
  durationHours: null,
  fee: null,
  exitCapturedAt: null,
  timeAdjusted: false,
  receiptNumber: null,
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  resetServerClock();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SessionTimer (active session)', () => {
  it('shows HH:MM:SS from the entry timestamp and a labelled estimate', () => {
    vi.setSystemTime(new Date('2026-10-09T06:35:09Z')); // 2 h 5 min 9 s after entry
    render(<SessionTimer session={active} />);

    expect(screen.getByRole('timer', { name: 'Parked for' })).toHaveTextContent('02:05:09');
    expect(screen.getByText(/^Entered/)).toHaveTextContent('Entered 9 Oct 2026');
    expect(screen.getByText('Estimated fee so far')).toBeInTheDocument();
    expect(
      screen.getByText(/Estimate only: billed in whole clock hours, 10:00 to 12:00/),
    ).toBeInTheDocument();
  });

  it('ticks every second', () => {
    vi.setSystemTime(new Date('2026-10-09T05:30:00Z'));
    render(<SessionTimer session={active} />);
    expect(screen.getByRole('timer')).toHaveTextContent('01:00:00');

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('01:00:03');
  });

  it('starts from the entry timestamp on every mount, not from zero', () => {
    vi.setSystemTime(new Date('2026-10-09T05:30:00Z'));
    const first = render(<SessionTimer session={active} />);
    expect(screen.getByRole('timer')).toHaveTextContent('01:00:00');
    first.unmount();

    vi.setSystemTime(new Date('2026-10-09T05:45:30Z')); // user navigated away, came back
    render(<SessionTimer session={active} />);
    expect(screen.getByRole('timer')).toHaveTextContent('01:15:30');
  });

  it('catches up after the app was in the background', () => {
    vi.setSystemTime(new Date('2026-10-09T05:30:00Z'));
    render(<SessionTimer session={active} />);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(vi.getTimerCount()).toBe(0); // no ticking while hidden

    vi.setSystemTime(new Date('2026-10-09T05:40:00Z')); // ten minutes pass in the background
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByRole('timer')).toHaveTextContent('01:10:00');
  });

  it('keeps counting past midnight instead of wrapping', () => {
    vi.setSystemTime(new Date('2026-10-10T07:00:00Z')); // 26.5 h after entry
    render(<SessionTimer session={active} />);
    expect(screen.getByRole('timer')).toHaveTextContent('26:30:00');
  });

  it('cleans up its interval when it unmounts', () => {
    vi.setSystemTime(new Date('2026-10-09T05:30:00Z'));
    const view = render(<SessionTimer session={active} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asks for a fresh estimate once, when the campus hour turns', () => {
    const onStale = vi.fn();
    vi.setSystemTime(new Date('2026-10-09T06:29:58Z')); // 11:59:58 IST
    render(<SessionTimer session={{ ...active, currentHour: 11 }} onStale={onStale} />);
    expect(onStale).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(3_000); // 12:00:01 IST
    });
    expect(onStale).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onStale).toHaveBeenCalledTimes(1);
  });
});

describe('SessionTimer (completed session)', () => {
  it('shows the exit time, total time and the frozen final fee', () => {
    const completed: ParkingSessionView = {
      ...active,
      status: 'COMPLETED',
      lifecycle: 'COMPLETED',
      entryReference: null,
      currentHour: null,
      currentDurationHours: null,
      estimatedFee: null,
      exitHour: 13,
      exitAt: '2026-10-09T08:35:09.000Z', // 14:05:09 IST, 4 h 5 min 9 s after entry
      durationHours: 3,
      fee: fee(1000),
    };
    render(<SessionTimer session={completed} />);

    expect(screen.getByText('Total time parked')).toBeInTheDocument();
    expect(screen.getByText('04:05:09')).toBeInTheDocument();
    expect(screen.getByText('Final fee')).toBeInTheDocument();
    expect(screen.getByText('₹10')).toBeInTheDocument();
    expect(screen.getByText('3 hours')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('SessionTimer (stopped at the exit gate)', () => {
  it('stays on the captured exit time however long it is looked at, and after a re-render', () => {
    // Security scanned the session at 12:00 IST (06:30 UTC); two hours later it still reads 02:00:00.
    vi.setSystemTime(new Date('2026-10-09T08:30:00Z'));
    const stopped: ParkingSessionView = { ...active, exitCapturedAt: '2026-10-09T06:30:00.000Z' };
    const first = render(<SessionTimer session={stopped} />);

    expect(screen.getByRole('timer')).toHaveTextContent('02:00:00');
    expect(screen.getByText('Timer stopped')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('02:00:00');
    expect(vi.getTimerCount()).toBe(0); // nothing keeps ticking

    first.unmount();
    render(<SessionTimer session={stopped} />);
    expect(screen.getByRole('timer')).toHaveTextContent('02:00:00');
  });
});
