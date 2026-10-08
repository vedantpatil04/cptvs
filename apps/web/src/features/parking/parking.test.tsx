import type {
  CheckInResponse,
  CheckoutQuote,
  ParkingMapResponse,
  ParkingSessionView,
  PaymentView,
  ReceiptView,
} from '@cpvts/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { jsonResponse, mockApi, renderAt, signInAs } from '@/test/utils';

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
  entryAt: new Date().toISOString(),
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

const fee = {
  ownerCategory: 'STUDENT' as const,
  vehicleType: 'TWO_WHEELER' as const,
  durationHours: 4,
  rule: { type: 'FREE_HOURS_THEN_HOURLY' as const, freeHours: 2, hourlyRatePaise: 1000 },
  lines: [
    { kind: 'FREE' as const, hours: 2 },
    { kind: 'CHARGED' as const, hours: 2, ratePaise: 1000, amountPaise: 2000 },
  ],
  totalPaise: 2000,
};

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('vehicle entry', () => {
  it('validates input, checks the vehicle in and explains the allocation', async () => {
    const checkIn: CheckInResponse = {
      session,
      categorySource: 'OPERATOR',
      allocation: {
        slotCode: 'T-04',
        zoneName: 'Two-Wheeler Zone',
        blockName: 'Two-Wheeler Parking Block',
        score: -3,
        factors: { priority: 0, usesToday: 0, layoutPosition: 3 },
        candidatesConsidered: 7,
        fallbacks: 0,
        checks: [
          'CORRECT_ZONE',
          'AVAILABLE',
          'NOT_BLOCKED',
          'BEST_SCORE',
          'FINAL_AVAILABILITY_VERIFIED',
        ],
      },
    };
    const sent = vi.fn((_body: unknown) => checkIn);
    mockApi({ ...signInAs('SECURITY_STAFF'), 'POST /parking/check-ins': sent });
    renderAt('/staff/entry');

    await userEvent.click(await screen.findByRole('button', { name: 'Check in and assign slot' }));
    expect(await screen.findByText('This field is required.')).toBeInTheDocument();
    expect(screen.getAllByText('Please choose an option.')).toHaveLength(2);

    await userEvent.type(screen.getByLabelText('Vehicle number'), 'HELLO');
    await userEvent.click(screen.getByRole('button', { name: 'Check in and assign slot' }));
    expect(
      await screen.findByText('Enter a valid vehicle number, for example KA22AB1234.'),
    ).toBeInTheDocument();
    expect(sent).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('Vehicle number'));
    await userEvent.type(screen.getByLabelText('Vehicle number'), 'ka 22 ab 1234');
    await userEvent.click(screen.getByRole('radio', { name: 'Two-wheeler' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Student' }));
    await userEvent.selectOptions(screen.getByLabelText('Entry hour'), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Check in and assign slot' }));

    expect(await screen.findByText('Vehicle checked in')).toBeInTheDocument();
    expect(screen.getByText('T-04')).toBeInTheDocument();
    expect(screen.getByText('Final availability verified before assignment')).toBeInTheDocument();
    expect(screen.getByText('Best valid allocation score (-3)')).toBeInTheDocument();
    expect(sent).toHaveBeenCalledWith({
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      ownerCategory: 'STUDENT',
      entryHour: 9,
    });
  });

  it('shows the translated server rejection for a duplicate vehicle', async () => {
    mockApi({
      ...signInAs('SECURITY_STAFF'),
      'POST /parking/check-ins': jsonResponse(409, {
        error: { code: 'DUPLICATE_ACTIVE_VEHICLE', message: 'x' },
      }),
    });
    await i18n.changeLanguage('kn');
    renderAt('/staff/entry');
    await userEvent.type(await screen.findByLabelText('ವಾಹನ ಸಂಖ್ಯೆ'), 'KA22AB1234');
    await userEvent.click(screen.getByRole('radio', { name: 'ದ್ವಿಚಕ್ರ ವಾಹನ' }));
    await userEvent.click(screen.getByRole('radio', { name: 'ವಿದ್ಯಾರ್ಥಿ' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'ಚೆಕ್ ಇನ್ ಮಾಡಿ ಮತ್ತು ಸ್ಥಳ ನಿಯೋಜಿಸಿ' }),
    );
    expect(
      await screen.findByText(
        'ಈ ವಾಹನವನ್ನು ಈಗಾಗಲೇ ನಿಲ್ಲಿಸಲಾಗಿದೆ. ಮತ್ತೆ ಚೆಕ್ ಇನ್ ಮಾಡುವ ಮೊದಲು ಚೆಕ್ ಔಟ್ ಮಾಡಿ.',
      ),
    ).toBeInTheDocument();
  });

  it('is not available to administrators', async () => {
    mockApi(signInAs('ADMIN'));
    renderAt('/staff/entry');
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });
});

describe('vehicle exit', () => {
  it('finds the vehicle, previews the fee, runs the test payment and links the receipt', async () => {
    const quote: CheckoutQuote = { session, exitHour: 13, durationHours: 4, fee };
    const pending: PaymentView = {
      id: '11111111-1111-4111-8111-111111111111',
      transactionId: 'TXN-7F84K29MQA',
      method: 'UPI',
      status: 'PENDING',
      amountPaise: 2000,
      exitHour: 13,
      isSimulated: true,
      failureReason: null,
      paidAt: null,
      createdAt: new Date().toISOString(),
    };
    const receipt = { receiptNumber: 'CPVTS-R-2026-8F3K2Q9M' } as ReceiptView;
    const quoteHandler = vi.fn(() => quote);
    mockApi({
      ...signInAs('SECURITY_STAFF'),
      'GET /parking/tracking': { matchedBy: 'VEHICLE_NUMBER', session },
      'POST /parking/checkouts/quote': quoteHandler,
      'POST /parking/payments': { payment: pending, quote },
      [`POST /parking/payments/${pending.id}/process`]: {
        payment: { ...pending, status: 'PAID', paidAt: new Date().toISOString() },
        receipt,
      },
    });
    renderAt('/staff/exit');

    await userEvent.type(
      await screen.findByLabelText('Vehicle number, slot ID, session number or entry QR'),
      'KA22AB1234',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Find vehicle' }));
    expect(await screen.findByText('Parked vehicle')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Calculate fee' }));
    const preview = await screen.findByText('Fee preview');
    const card = preview.closest('[data-slot=card]') as HTMLElement;
    expect(within(card).getByText('2 hours free')).toBeInTheDocument();
    expect(within(card).getByText('2 hours × ₹10')).toBeInTheDocument();
    expect(within(card).getAllByText('₹20').length).toBeGreaterThan(0);
    expect(
      within(card).getByText('This is a test/demo payment. No real money is charged.'),
    ).toBeInTheDocument();
    // The identifier used to find the vehicle is re-verified by the server.
    expect(quoteHandler).toHaveBeenCalledWith({
      sessionNumber: session.sessionNumber,
      exitHour: 13,
      vehicleNumber: 'KA22AB1234',
    });

    await userEvent.click(within(card).getByRole('button', { name: 'Pay ₹20' }));
    expect(
      await screen.findByText('Payment successful', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('CPVTS-R-2026-8F3K2Q9M')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View receipt/ })).toHaveAttribute(
      'href',
      '/staff/receipts/CPVTS-R-2026-8F3K2Q9M',
    );
  });
});

describe('live parking map', () => {
  it('shows slot states and highlights the requested slot', async () => {
    const map: ParkingMapResponse = {
      generatedAt: new Date().toISOString(),
      currentHour: 13,
      blocks: [
        {
          code: 'BLOCK-2W',
          name: 'Two-Wheeler Parking Block',
          description: null,
          coordinates: { latitude: 15.85, longitude: 74.5 },
          isActive: true,
          zones: [
            {
              code: 'ZONE-2W',
              name: 'Two-Wheeler Zone',
              vehicleType: 'TWO_WHEELER',
              isActive: true,
              counts: { total: 3, available: 1, occupied: 1, blocked: 1, held: 0 },
              slots: [
                { code: 'T-01', status: 'AVAILABLE', blockedReason: null, occupant: null },
                { code: 'T-02', status: 'BLOCKED', blockedReason: 'Maintenance', occupant: null },
                {
                  code: 'T-04',
                  status: 'OCCUPIED',
                  blockedReason: null,
                  occupant: {
                    sessionNumber: session.sessionNumber,
                    vehicleNumber: 'KA22AB1234',
                    vehicleType: 'TWO_WHEELER',
                    ownerCategory: 'STUDENT',
                    entryHour: 9,
                    currentDurationHours: 4,
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    mockApi({
      ...signInAs('ADMIN'),
      'GET /parking/map': map,
      'GET /parking/sessions/active': { currentHour: 13, sessions: [session] },
    });
    renderAt('/admin/live?slot=T-04');

    const occupied = await screen.findByRole('button', { name: 'T-04, Occupied, KA22AB1234' });
    expect(occupied).toHaveAttribute('aria-current', 'location');
    expect(screen.getByRole('button', { name: 'T-02, Blocked' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByText('1 of 3 available')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in Google Maps/ })).toBeInTheDocument();

    await userEvent.click(occupied);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Slot T-04')).toBeInTheDocument();
    expect(within(dialog).getByText('4 hours')).toBeInTheDocument();
    // Administrators can view but not check out.
    expect(within(dialog).queryByRole('link', { name: 'Check out' })).not.toBeInTheDocument();
  });
});
