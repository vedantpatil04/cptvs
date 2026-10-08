import type { LoginResponse, PublicOverviewResponse } from '@cpvts/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import i18n from '@/i18n';

import { mockApi } from '@/test/utils';

import { router } from './router';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const loginResponse = (role: 'ADMIN' | 'SECURITY_STAFF'): LoginResponse => ({
  accessToken: 'token',
  tokenType: 'Bearer',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: 'u1', username: 'demo', fullName: 'Demo User', role, lastLoginAt: null },
});

const renderAt = (path: string) => {
  const memoryRouter = createMemoryRouter(router.routes, { initialEntries: [path] });
  render(
    <AuthProvider>
      <RouterProvider router={memoryRouter} />
    </AuthProvider>,
  );
  return memoryRouter;
};

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

afterEach(() => vi.unstubAllGlobals());

const overview: PublicOverviewResponse = {
  generatedAt: new Date().toISOString(),
  availability: [
    { vehicleType: 'TWO_WHEELER', totalSlots: 10, availableSlots: 7 },
    { vehicleType: 'FOUR_WHEELER', totalSlots: 5, availableSlots: 0 },
  ],
  locations: [
    {
      code: 'BLOCK-2W',
      name: 'Two-Wheeler Parking Block',
      description: null,
      vehicleTypes: ['TWO_WHEELER'],
      coordinates: { latitude: 15.85, longitude: 74.5 },
    },
    {
      code: 'BLOCK-4W',
      name: 'Four-Wheeler Parking Block',
      description: null,
      vehicleTypes: ['FOUR_WHEELER'],
      coordinates: null,
    },
  ],
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
};

describe('public landing page', () => {
  it('opens at / without signing in and shows only the public overview', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, overview));
    vi.stubGlobal('fetch', fetchMock);
    const memoryRouter = renderAt('/');

    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.getByText('of 10 spaces free')).toBeInTheDocument();
    expect(screen.getByText('Full')).toBeInTheDocument();
    expect(screen.getByText('First 2 hours free, then ₹10 per hour')).toBeInTheDocument();
    expect(screen.getByText('₹40 per hour')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in Google Maps/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=15.85%2C74.5',
    );
    expect(screen.getByRole('button', { name: /Map location not configured yet/ })).toBeDisabled();
    expect(screen.getAllByRole('link', { name: /Admin \/ Staff login/ })[0]).toHaveAttribute(
      'href',
      '/login',
    );
    expect(memoryRouter.state.location.pathname).toBe('/');

    // Only the public endpoint is called, without credentials.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/api/v1/public/overview');
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('serves the Help & FAQ page publicly', async () => {
    renderAt('/help');
    expect(await screen.findByRole('heading', { name: 'Help & FAQ' })).toBeInTheDocument();
    expect(screen.getByText('Can I look up a parked vehicle here?')).toBeInTheDocument();
  });

  it('shows a public not-found page for unknown addresses', async () => {
    const memoryRouter = renderAt('/no-such-page');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(memoryRouter.state.location.pathname).toBe('/no-such-page');
  });
});

describe('protected routes', () => {
  it.each(['/admin', '/admin/account', '/staff', '/staff/unknown'])(
    'redirects anonymous visitors from %s to the sign-in page',
    async (path) => {
      const memoryRouter = renderAt(path);
      expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
      expect(memoryRouter.state.location.pathname).toBe('/login');
    },
  );

  it('signs in security staff and lands on the staff dashboard', async () => {
    const fetchMock = mockApi({
      'POST /auth/login': loginResponse('SECURITY_STAFF'),
      'GET /dashboard/summary': jsonResponse(503, {
        error: { code: 'SERVICE_UNAVAILABLE', message: 'x' },
      }),
    });
    const memoryRouter = renderAt('/login');

    await userEvent.type(await screen.findByLabelText('Username'), 'demo');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Welcome, Demo User' })).toBeInTheDocument();
    expect(memoryRouter.state.location.pathname).toBe('/staff');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns to the originally requested page after signing in', async () => {
    mockApi({ 'POST /auth/login': loginResponse('ADMIN') });
    const memoryRouter = renderAt('/admin/account');

    await userEvent.type(await screen.findByLabelText('Username'), 'demo');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'My account' })).toBeInTheDocument();
    expect(memoryRouter.state.location.pathname).toBe('/admin/account');
  });

  it('shows a translated validation message for empty fields', async () => {
    await i18n.changeLanguage('hi');
    renderAt('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'साइन इन करें' }));
    expect(await screen.findAllByText('यह फ़ील्ड आवश्यक है।')).toHaveLength(2);
  });

  it('shows the translated API error for wrong credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS', message: 'x' } }),
        ),
    );
    renderAt('/login');
    await userEvent.type(await screen.findByLabelText('Username'), 'demo');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('The username or password is incorrect.')).toBeInTheDocument();
  });

  it('denies security staff access to admin pages', async () => {
    localStorage.setItem(
      'cpvts.session',
      JSON.stringify({
        accessToken: 'token',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { user: loginResponse('SECURITY_STAFF').user })),
    );
    renderAt('/admin');
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });
});
