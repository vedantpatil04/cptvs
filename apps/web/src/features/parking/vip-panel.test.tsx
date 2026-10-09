import type { ParkingMapResponse, SlotReservationView } from '@cpvts/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { mockApi, renderAt, signInAs } from '@/test/utils';

const map: ParkingMapResponse = {
  generatedAt: new Date().toISOString(),
  currentHour: 12,
  blocks: [
    {
      code: 'BLOCK-4W',
      name: 'Four-Wheeler Parking Block',
      description: null,
      coordinates: null,
      isActive: true,
      zones: [
        {
          code: 'ZONE-4W',
          name: 'Four-Wheeler Zone',
          vehicleType: 'FOUR_WHEELER',
          isActive: true,
          counts: { total: 2, available: 1, occupied: 0, blocked: 0, held: 0, reserved: 1 },
          slots: [
            { code: 'F-01', status: 'AVAILABLE', blockedReason: null, occupant: null },
            { code: 'F-02', status: 'RESERVED', blockedReason: null, occupant: null },
          ],
        },
      ],
    },
  ],
};

const reservation = (overrides: Partial<SlotReservationView> = {}): SlotReservationView => ({
  id: '11111111-1111-4111-8111-111111111111',
  slotCode: 'F-02',
  block: { code: 'BLOCK-4W', name: 'Four-Wheeler Parking Block', coordinates: null },
  zone: { code: 'ZONE-4W', name: 'Four-Wheeler Zone' },
  vehicleType: 'FOUR_WHEELER',
  vehicleNumber: null,
  guestName: 'Chief Guest',
  reason: 'Official guest of the Principal',
  status: 'ACTIVE',
  reservedAt: new Date().toISOString(),
  reservedByName: 'Security Staff',
  releasedAt: null,
  releasedByName: null,
  releaseNote: null,
  slotStatus: 'RESERVED',
  sessionNumber: null,
  ...overrides,
});

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('VIP / emergency slot reservations', () => {
  it('reserves a free slot only after the guard confirms', async () => {
    const reserve = vi.fn(() => reservation({ slotCode: 'F-01' }));
    mockApi({
      ...signInAs('SECURITY_STAFF'),
      'GET /parking/vip-reservations': { reservations: [] },
      'GET /parking/map': map,
      'POST /parking/vip-reservations': reserve,
    });
    renderAt('/staff');

    await userEvent.click(await screen.findByRole('button', { name: 'Reserve VIP slot' }));
    const slot = await screen.findByLabelText('Slot');
    // Only the free slot is offered, not the reserved one.
    expect(screen.getByRole('option', { name: /F-01/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /F-02/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(slot, 'F-01');
    await userEvent.type(screen.getByLabelText('Guest name or purpose'), 'Chief Guest');
    await userEvent.type(screen.getByLabelText('Reason'), 'Official guest of the Principal');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));

    // Nothing is sent until the confirmation.
    expect(await screen.findByText('Reserve F-01?')).toBeInTheDocument();
    expect(reserve).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm reservation' }));
    expect(reserve).toHaveBeenCalledWith({
      slotCode: 'F-01',
      vehicleNumber: undefined,
      guestName: 'Chief Guest',
      reason: 'Official guest of the Principal',
    });
  });

  it('unreserves only after a confirmation, and not while the VIP is parked', async () => {
    const release = vi.fn(() => reservation({ status: 'RELEASED' }));
    mockApi({
      ...signInAs('SECURITY_STAFF'),
      'GET /parking/vip-reservations': {
        reservations: [
          reservation(),
          reservation({
            id: 'r2',
            slotCode: 'F-03',
            slotStatus: 'OCCUPIED',
            sessionNumber: 'CPVTS-P-7K4M92QX',
          }),
        ],
      },
      'GET /parking/map': map,
      'POST /parking/vip-reservations/11111111-1111-4111-8111-111111111111/release': release,
    });
    renderAt('/staff');

    const buttons = await screen.findAllByRole('button', { name: 'Unreserve' });
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).toBeDisabled(); // the VIP is parked in F-03
    expect(screen.getByText('VIP parked')).toBeInTheDocument();

    await userEvent.click(buttons[0]!);
    expect(await screen.findByText('Unreserve F-02?')).toBeInTheDocument();
    expect(release).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Unreserve slot' }));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('asks Security to confirm the guest when no vehicle was named', async () => {
    const checkIn = vi.fn();
    mockApi({
      ...signInAs('SECURITY_STAFF'),
      'GET /parking/vip-reservations': { reservations: [reservation()] },
      'GET /parking/map': map,
      'POST /parking/vip-reservations/11111111-1111-4111-8111-111111111111/check-in': checkIn,
    });
    renderAt('/staff');

    await userEvent.click(await screen.findByRole('button', { name: 'Check in VIP' }));
    await userEvent.type(await screen.findByLabelText('Vehicle number'), 'KA01VP0001');
    expect(screen.getByRole('button', { name: 'Check in' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Check in' })).toBeEnabled();
  });

  it('shows administrators the reservations read-only', async () => {
    mockApi({
      ...signInAs('ADMIN'),
      'GET /parking/vip-reservations': { reservations: [reservation()] },
    });
    renderAt('/admin');

    expect(await screen.findByText('Chief Guest')).toBeInTheDocument();
    expect(screen.getByText(/Reserved by Security Staff/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reserve VIP slot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unreserve' })).not.toBeInTheDocument();
  });
});
