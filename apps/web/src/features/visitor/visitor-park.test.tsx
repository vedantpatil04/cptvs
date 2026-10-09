import type {
  PublicOverviewResponse,
  VisitorReservationCreated,
  VisitorReservationStatusResponse,
  VisitorReservationView,
} from '@cpvts/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { jsonResponse, mockApi, renderAt } from '@/test/utils';

const overview = (twoWheelerFree = 7): PublicOverviewResponse => ({
  generatedAt: new Date().toISOString(),
  availability: [
    { vehicleType: 'TWO_WHEELER', totalSlots: 10, availableSlots: twoWheelerFree },
    { vehicleType: 'FOUR_WHEELER', totalSlots: 5, availableSlots: 2 },
  ],
  locations: [],
  blockAvailability: [],
  feeSchedule: {
    currency: 'INR',
    rules: {
      STAFF: { TWO_WHEELER: { type: 'FREE' }, FOUR_WHEELER: { type: 'FREE' } },
      STUDENT: {
        TWO_WHEELER: { type: 'FREE_HOURS_THEN_HOURLY', freeHours: 2, hourlyRatePaise: 1000 },
        FOUR_WHEELER: { type: 'FREE_HOURS_THEN_HOURLY', freeHours: 2, hourlyRatePaise: 2000 },
      },
      VISITOR: {
        TWO_WHEELER: { type: 'HOURLY', hourlyRatePaise: 2000 },
        FOUR_WHEELER: { type: 'HOURLY', hourlyRatePaise: 4000 },
      },
    },
  },
});

const reservation = (overrides: Partial<VisitorReservationView> = {}): VisitorReservationView => ({
  reservationId: '11111111-1111-4111-8111-111111111111',
  status: 'HELD',
  expiresAt: new Date(Date.now() + 14 * 60_000).toISOString(),
  holdSeconds: 900,
  vehicleNumber: 'KA22AB1234',
  vehicleType: 'TWO_WHEELER',
  block: { code: 'BLOCK-2W', name: 'Two-Wheeler Parking Block', coordinates: null },
  zone: { code: 'ZONE-2W', name: 'Two-Wheeler Zone' },
  slotCode: 'T-03',
  qrReference: 'A'.repeat(43),
  sessionNumber: null,
  ...overrides,
});

const created = (): VisitorReservationCreated => ({
  reservation: reservation(),
  accessToken: 'reservation-token',
  accessExpiresAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
});

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('visitor "Park My Vehicle"', () => {
  it('shows live free spaces and asks only for the vehicle and a phone number', async () => {
    mockApi({ 'GET /public/overview': overview() });
    renderAt('/visitor/park');

    expect(await screen.findByLabelText('Vehicle number')).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument(); // two-wheelers free, from the server
    // No block or slot to choose anywhere.
    expect(screen.queryByText(/choose a block|select a slot/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Park My Vehicle' })).toBeEnabled();
  });

  it('validates the input before asking the server', async () => {
    const reserve = vi.fn(() => created());
    mockApi({ 'GET /public/overview': overview(), 'POST /public/visitor-reservations': reserve });
    renderAt('/visitor/park');

    await userEvent.type(await screen.findByLabelText('Vehicle number'), 'nope');
    await userEvent.type(screen.getByLabelText('Mobile number'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Park My Vehicle' }));

    expect(
      await screen.findByText('Enter a valid vehicle number, for example KA22AB1234.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Enter a valid phone number (10–15 digits).')).toBeInTheDocument();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('shows the assigned block and slot, a QR and a countdown, and keeps the pass', async () => {
    const reserve = vi.fn(() => created());
    mockApi({
      'GET /public/overview': overview(),
      'POST /public/visitor-reservations': reserve,
      'GET /visitor/reservation': { reservation: reservation(), session: null },
    });
    renderAt('/visitor/park');

    await userEvent.type(await screen.findByLabelText('Vehicle number'), 'ka22ab1234');
    await userEvent.type(screen.getByLabelText('Mobile number'), '98765 43210');
    await userEvent.click(screen.getByRole('button', { name: 'Park My Vehicle' }));

    expect(await screen.findByText('Space reserved for you')).toBeInTheDocument();
    expect(reserve).toHaveBeenCalledWith({
      vehicleNumber: 'KA22AB1234',
      vehicleType: 'TWO_WHEELER',
      contactPhone: '9876543210',
    });
    // The server decided the placement.
    expect(await screen.findByText('T-03')).toBeInTheDocument();
    expect(screen.getByText('Two-Wheeler Parking Block')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Parking session QR' })).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(/1[34]:\d\d/);
    expect(screen.getByText('₹20 per hour', { exact: false })).toBeInTheDocument();
    // The pass survives a reload of the app.
    expect(localStorage.getItem('cpvts_visitor_reservation')).toContain('reservation-token');
  });

  it('shows the translated reason when the server refuses', async () => {
    mockApi({
      'GET /public/overview': overview(),
      'POST /public/visitor-reservations': () =>
        jsonResponse(409, { error: { code: 'VISITOR_VEHICLE_REGISTERED', message: 'x' } }),
    });
    renderAt('/visitor/park');

    await userEvent.type(await screen.findByLabelText('Vehicle number'), 'KA22AB1234');
    await userEvent.type(screen.getByLabelText('Mobile number'), '9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Park My Vehicle' }));

    expect(
      await screen.findByText(
        'This vehicle is registered to a CPVTS account. Sign in and use Park My Vehicle.',
      ),
    ).toBeInTheDocument();
    expect(localStorage.getItem('cpvts_visitor_reservation')).toBeNull();
  });

  it('does not offer to reserve when no space is free for the chosen vehicle type', async () => {
    mockApi({ 'GET /public/overview': overview(0) });
    renderAt('/visitor/park');

    expect(await screen.findByText(/No spaces are free for this vehicle type/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Park My Vehicle' })).toBeDisabled();
  });

  it('returns to the saved pass after the app is reopened', async () => {
    localStorage.setItem(
      'cpvts_visitor_reservation',
      JSON.stringify({
        token: 'reservation-token',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    mockApi({
      'GET /public/overview': overview(),
      'GET /visitor/reservation': { reservation: reservation(), session: null },
    });
    renderAt('/visitor/park');

    expect(await screen.findByText('Space reserved for you')).toBeInTheDocument();
    expect(screen.getByText('T-03')).toBeInTheDocument();
  });

  it('hands over to the live session once Security has started it', async () => {
    localStorage.setItem(
      'cpvts_visitor_reservation',
      JSON.stringify({
        token: 'reservation-token',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    const status: VisitorReservationStatusResponse = {
      reservation: reservation({ status: 'ACTIVATED', sessionNumber: 'CPVTS-P-7K4M92QX' }),
      session: {
        accessToken: 'session-token',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        sessionNumber: 'CPVTS-P-7K4M92QX',
      },
    };
    mockApi({
      'GET /public/overview': overview(),
      'GET /visitor/reservation': status,
      'GET /visitor/session': jsonResponse(500, {
        error: { code: 'INTERNAL_ERROR', message: 'x' },
      }),
      'GET /visitor/layout': jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'x' } }),
    });
    const memoryRouter = renderAt('/visitor/park');

    await vi.waitFor(() => expect(memoryRouter.state.location.pathname).toBe('/visitor/parking'));
    expect(sessionStorage.getItem('cpvts_visitor_token')).toBe('session-token');
  });

  it('explains an expired reservation and offers to reserve again', async () => {
    localStorage.setItem(
      'cpvts_visitor_reservation',
      JSON.stringify({
        token: 'reservation-token',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    mockApi({
      'GET /public/overview': overview(),
      'GET /visitor/reservation': {
        reservation: reservation({ status: 'EXPIRED', qrReference: null }),
        session: null,
      },
    });
    renderAt('/visitor/park');

    expect(await screen.findByText('This reservation has ended')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reserve again' }));
    expect(await screen.findByLabelText('Vehicle number')).toBeInTheDocument();
    expect(localStorage.getItem('cpvts_visitor_reservation')).toBeNull();
  });
});
