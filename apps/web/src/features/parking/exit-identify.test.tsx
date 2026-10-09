import type { ParkingSessionView, ScanCheckoutResponse } from '@cpvts/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { jsonResponse, mockApi, renderAt, signInAs } from '@/test/utils';

/**
 * Stand-in for the camera: the real scanners need a physical camera (and, on Android, the
 * native plugin). It reads the same QR text twice in a row, like a camera that keeps seeing
 * the code, so the page's duplicate-scan protection is exercised.
 */
vi.mock('@/components/parking/QrScanner', () => ({
  QrScanner: ({
    onScan,
    onCancel,
    onUseCode,
  }: {
    onScan: (value: string) => void;
    onCancel: () => void;
    onUseCode: () => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => {
          onScan('cpvts:session:ref-1');
          onScan('cpvts:session:ref-1');
        }}
      >
        simulate camera read
      </button>
      <button type="button" onClick={onCancel}>
        simulate cancel
      </button>
      <button type="button" onClick={onUseCode}>
        simulate use code
      </button>
    </div>
  ),
}));

const session: ParkingSessionView = {
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
  entryHour: 9,
  entryAt: '2026-10-09T04:30:00.000Z',
  entryReference: 'A'.repeat(43),
  currentHour: 13,
  currentDurationHours: 4,
  estimatedFee: null,
  exitHour: null,
  exitAt: null,
  durationHours: null,
  fee: null,
  receiptNumber: null,
};

const verified = (matchedBy: ScanCheckoutResponse['matchedBy']): ScanCheckoutResponse => ({
  matchedBy,
  session,
  exitRequested: false,
  checks: {
    reference: true,
    sessionActive: true,
    vehicleMatchesSession: true,
    slotMatchesSession: true,
  },
});

const rejection = (status: number, code: string) =>
  jsonResponse(status, { error: { code, message: code } });

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('identifying the vehicle at the exit gate', () => {
  it('shows the server-verified vehicle after a QR scan, and completes nothing', async () => {
    const scan = vi.fn(() => verified('ENTRY_QR'));
    const fetchMock = mockApi({
      ...signInAs('SECURITY_STAFF'),
      'POST /parking/checkouts/scan': scan,
    });
    renderAt('/staff/exit');

    await userEvent.click(await screen.findByRole('button', { name: 'Scan QR' }));
    await userEvent.click(screen.getByRole('button', { name: 'simulate camera read' }));

    expect(await screen.findByText('Verified by Parking Session QR')).toBeInTheDocument();
    // The authoritative vehicle number, slot and block are shown before anything else happens.
    expect(screen.getByText('KA22AB1234')).toBeInTheDocument();
    expect(screen.getByText('T-04')).toBeInTheDocument();
    expect(screen.getAllByText(/Two-Wheeler Parking Block/).length).toBeGreaterThan(0);
    // The camera read the code twice, the server was asked once.
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith({ qr: 'cpvts:session:ref-1' });
    // Scanning never creates a payment or finalizes a checkout.
    const paths = fetchMock.mock.calls.map(([url]) => String(url));
    expect(paths.some((path) => path.includes('/parking/payments'))).toBe(false);
    expect(paths.some((path) => path.includes('/parking/checkouts/quote'))).toBe(false);
  });

  it('explains an invalid or expired QR and lets the operator scan again', async () => {
    mockApi({
      ...signInAs('SECURITY_STAFF'),
      'POST /parking/checkouts/scan': () => rejection(400, 'INVALID_QR_REFERENCE'),
    });
    renderAt('/staff/exit');

    await userEvent.click(await screen.findByRole('button', { name: 'Scan QR' }));
    await userEvent.click(screen.getByRole('button', { name: 'simulate camera read' }));

    expect(await screen.findByText('QR code check failed')).toBeInTheDocument();
    expect(screen.getByText('This QR code is not a valid entry code.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Scan again' }));
    expect(await screen.findByRole('button', { name: 'simulate camera read' })).toBeInTheDocument();
  });

  it('reports a network failure instead of pretending the scan worked', async () => {
    const auth = signInAs('SECURITY_STAFF');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL | string) => {
        if (String(input).includes('/auth/me')) return jsonResponse(200, auth['GET /auth/me']);
        throw new TypeError('Failed to fetch');
      }),
    );
    renderAt('/staff/exit');

    await userEvent.click(await screen.findByRole('button', { name: 'Scan QR' }));
    await userEvent.click(screen.getByRole('button', { name: 'simulate camera read' }));

    expect(await screen.findByText('QR code check failed')).toBeInTheDocument();
    expect(screen.queryByText('Verified by Parking Session QR')).not.toBeInTheDocument();
  });

  it('closes the scanner when the operator cancels', async () => {
    mockApi({ ...signInAs('SECURITY_STAFF') });
    renderAt('/staff/exit');

    await userEvent.click(await screen.findByRole('button', { name: 'Scan QR' }));
    await userEvent.click(screen.getByRole('button', { name: 'simulate cancel' }));

    expect(screen.queryByRole('button', { name: 'simulate camera read' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan QR' })).toBeInTheDocument();
  });

  it('moves to the 6-digit code from the scanner', async () => {
    mockApi({ ...signInAs('SECURITY_STAFF') });
    renderAt('/staff/exit');

    await userEvent.click(await screen.findByRole('button', { name: 'Scan QR' }));
    await userEvent.click(screen.getByRole('button', { name: 'simulate use code' }));

    expect(screen.queryByRole('button', { name: 'simulate camera read' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Exit code')).toHaveFocus();
  });
});

describe('the 6-digit code fallback', () => {
  it('accepts only six digits, then shows the verified vehicle', async () => {
    const byCode = vi.fn(() => verified('EXIT_CODE'));
    mockApi({ ...signInAs('SECURITY_STAFF'), 'POST /parking/checkouts/code': byCode });
    renderAt('/staff/exit');

    const field = await screen.findByLabelText('Exit code');
    const submit = screen.getByRole('button', { name: 'Verify code' });
    expect(submit).toBeDisabled();

    await userEvent.type(field, '12ab34');
    expect(field).toHaveValue('1234');
    expect(submit).toBeDisabled();

    await userEvent.type(field, '56789');
    expect(field).toHaveValue('123456');
    expect(submit).toBeEnabled();

    await userEvent.click(submit);
    expect(await screen.findByText('Verified by 6-digit code')).toBeInTheDocument();
    expect(byCode).toHaveBeenCalledWith({ code: '123456' });
    expect(screen.getByText('KA22AB1234')).toBeInTheDocument();
  });

  it('refuses a wrong or expired code with a translated message', async () => {
    mockApi({
      ...signInAs('SECURITY_STAFF'),
      'POST /parking/checkouts/code': () => rejection(400, 'INVALID_EXIT_CODE'),
    });
    renderAt('/staff/exit');

    await userEvent.type(await screen.findByLabelText('Exit code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(await screen.findByText('Code check failed')).toBeInTheDocument();
    expect(screen.getByText('This exit code is invalid or has expired.')).toBeInTheDocument();
    expect(screen.queryByText('Verified by 6-digit code')).not.toBeInTheDocument();
  });

  it('keeps manual lookup available, but out of the way', async () => {
    mockApi({ ...signInAs('SECURITY_STAFF') });
    renderAt('/staff/exit');

    expect(
      screen.queryByLabelText('Vehicle number, slot ID, session number or entry QR'),
    ).not.toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole('button', { name: /Look up by vehicle number or slot/ }),
    );
    expect(
      screen.getByLabelText('Vehicle number, slot ID, session number or entry QR'),
    ).toBeInTheDocument();
  });
});
