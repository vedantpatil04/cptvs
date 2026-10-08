import type { LoginResponse } from '@cpvts/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
import i18n from '@/i18n';

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

describe('protected routes', () => {
  it('redirects anonymous visitors to the sign-in page', async () => {
    const memoryRouter = renderAt('/admin');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(memoryRouter.state.location.pathname).toBe('/login');
  });

  it('signs in security staff and lands on the staff dashboard', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, loginResponse('SECURITY_STAFF')));
    vi.stubGlobal('fetch', fetchMock);
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, loginResponse('ADMIN'))));
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
