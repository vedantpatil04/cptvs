import type { AuthUser, UserRole } from '@cpvts/shared';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';

import { router } from '@/app/router';
import { AuthProvider } from '@/features/auth/AuthProvider';

export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Handler = unknown | ((body: unknown) => Response | unknown);

/**
 * Stubs `fetch` with routes keyed by "METHOD /path" (path relative to /api/v1,
 * without the query string). Unknown routes fail the request with 404.
 */
export const mockApi = (routes: Record<string, Handler>) => {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const key = `${init?.method ?? 'GET'} ${url.pathname.replace('/api/v1', '')}`;
    if (!(key in routes)) return jsonResponse(404, { error: { code: 'NOT_FOUND', message: key } });
    const handler = routes[key];
    const result =
      typeof handler === 'function'
        ? (handler as (body: unknown) => unknown)(
            init?.body ? JSON.parse(String(init.body)) : undefined,
          )
        : handler;
    return result instanceof Response ? result : jsonResponse(200, result);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

export const testUser = (role: UserRole): AuthUser => ({
  id: 'u1',
  username: 'demo',
  fullName: 'Demo User',
  role,
  lastLoginAt: null,
});

/** Stores a valid session so the app starts signed in (verified via GET /auth/me). */
export const signInAs = (role: UserRole) => {
  localStorage.setItem(
    'cpvts.session',
    JSON.stringify({
      accessToken: 'token',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  );
  return { 'GET /auth/me': { user: testUser(role) } };
};

export const renderAt = (path: string) => {
  const memoryRouter = createMemoryRouter(router.routes, { initialEntries: [path] });
  render(
    <AuthProvider>
      <RouterProvider router={memoryRouter} />
    </AuthProvider>,
  );
  return memoryRouter;
};
