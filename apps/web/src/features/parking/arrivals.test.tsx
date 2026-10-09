import type { ArrivalView, ParkingSessionView } from '@cpvts/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { jsonResponse, mockApi, renderAt, signInAs } from '@/test/utils';

/** The real scanners need a physical camera; this stand-in reads one fixed visitor QR. */
vi.mock('@/components/parking/QrScanner', () => ({
  QrScanner: ({ onScan }: { onScan: (value: string) => void }) => (
    <button type="button" onClick={() => onScan(`cpvts:session:${'A'.repeat(43)}`)}>
      simulate camera read
    </button>
  ),
}));

const arrival = (overrides: Partial<ArrivalView> = {}): ArrivalView => ({
  reservationId: '11111111-1111-4111-8111-111111111111',
  status: 'HELD',
  vehicleNumber: 'KA22AB1234',
  vehicleType: 'TWO_WHEELER',
  contactPhone: '+919876543210',
  block: { code: 'BLOCK-2W', name: 'Two-Wheeler Parking Block', coordinates: null },
  zone: { code: 'ZONE-2W', name: 'Two-Wheeler Zone' },
  slotCode: 'T-03',
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  sessionNumber: null,
  ...overrides,
});

const session: ParkingSessionView = {
  sessionNumber: 'CPVTS-P-7K4M92QX',
  status: 'ACTIVE',
  lifecycle: 'ACTIVE',
  exitRequestedAt: null,
  vehicleNumber: 'KA22AB1234',
  vehicleType: 'TWO_WHEELER',
  ownerCategory: 'VISITOR',
  block: { code: 'BLOCK-2W', name: 'Two-Wheeler Parking Block', coordinates: null },
  zone: { code: 'ZONE-2W', name: 'Two-Wheeler Zone' },
  slotCode: 'T-03',
  entryHour: 13,
  entryAt: new Date().toISOString(),
  entryReference: 'A'.repeat(43),
  currentHour: 13,
  currentDurationHours: 0,
  estimatedFee: null,
  exitHour: null,
  exitAt: null,
  durationHours: null,
  fee: null,
  exitCapturedAt: null,
  timeAdjusted: false,
  receiptNumber: null,
};

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('visitor arrivals at the Security desk', () => {
  it('verifies a scanned visitor QR and starts the session only after the guard confirms', async () => {
    const find = vi.fn(() => ({ matchedBy: 'ENTRY_QR', arrival: arrival() }));
    const activate = vi.fn(() => ({ session }));
    mockApi({
      ...signInAs('SECURITY_STAFF'),
      'GET /parking/arrivals/pending': { arrivals: [arrival()] },
      'POST /parking/arrivals/find': find,
      'POST /parking/arrivals/11111111-1111-4111-8111-111111111111/activate': activate,
    });
    renderAt('/staff/entry');

    await userEvent.click(await screen.findByRole('button', { name: 'Scan visitor QR' }));
    await userEvent.click(screen.getByRole('button', { name: 'simulate camera read' }));

    // What the server holds for this arrival is shown for the guard to check.
    expect(await screen.findByText('Verify arrival')).toBeInTheDocument();
    expect(find).toHaveBeenCalledWith({ qr: `cpvts:session:${'A'.repeat(43)}` });
    expect(screen.getAllByText('KA22AB1234').length).toBeGreaterThan(0);
    expect(screen.getByText('+919876543210')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
    // Finding the arrival starts nothing.
    expect(activate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Start parking session' }));
    expect(await screen.findByText('Session started in T-03')).toBeInTheDocument();
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('finds an arrival by vehicle number and lists the visitors still waiting', async () => {
    const find = vi.fn(() => ({ matchedBy: 'VEHICLE_NUMBER', arrival: arrival() }));
    mockApi({
      ...signInAs('SECURITY_STAFF'),
      'GET /parking/arrivals/pending': {
        arrivals: [
          arrival(),
          arrival({ reservationId: 'r2', vehicleNumber: 'KA01CD5678', slotCode: 'T-04' }),
        ],
      },
      'POST /parking/arrivals/find': find,
    });
    renderAt('/staff/entry');

    expect(await screen.findByText('KA01CD5678')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Visitor's vehicle number"), 'ka22ab1234');
    await userEvent.click(screen.getByRole('button', { name: 'Find' }));

    expect(await screen.findByText('Verify arrival')).toBeInTheDocument();
    expect(find).toHaveBeenCalledWith({ vehicleNumber: 'KA22AB1234' });
  });

  it('shows the translated reason for an expired or unknown reservation', async () => {
    mockApi({
      ...signInAs('SECURITY_STAFF'),
      'GET /parking/arrivals/pending': { arrivals: [] },
      'POST /parking/arrivals/find': () =>
        jsonResponse(409, { error: { code: 'RESERVATION_EXPIRED', message: 'x' } }),
    });
    renderAt('/staff/entry');

    await userEvent.click(await screen.findByRole('button', { name: 'Scan visitor QR' }));
    await userEvent.click(screen.getByRole('button', { name: 'simulate camera read' }));

    expect(
      await screen.findByText(
        'This reservation has expired or was cancelled. The space was released.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start parking session' })).not.toBeInTheDocument();
  });
});
