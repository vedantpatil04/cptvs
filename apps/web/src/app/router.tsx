import { createBrowserRouter } from 'react-router';

import { AppShell } from '@/components/layout/AppShell';
import { AccountPage } from '@/features/account/AccountPage';
import { PublicOnlyRoute, RequireAuth, RequireRole } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { AdminDashboardPage } from '@/features/dashboard/AdminDashboardPage';
import { StaffDashboardPage } from '@/features/dashboard/StaffDashboardPage';
import { HelpPage } from '@/features/public/HelpPage';
import { PublicHomePage } from '@/features/public/PublicHomePage';
import { PublicLayout } from '@/features/public/PublicLayout';

import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorPage } from './pages/RouteErrorPage';
import { PATHS } from './paths';

/**
 * Route tree:
 *   /            public landing page (aggregate parking overview, no sign-in)
 *   /help        public Help & FAQ
 *   /login       sign-in (redirects signed-in users)
 *   /admin/*     ADMIN only        ┐ require sign-in; unauthenticated
 *   /staff/*     SECURITY_STAFF    ┘ visitors are redirected to /login
 *   *            public "not found"
 */
export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { path: PATHS.home, element: <PublicHomePage /> },
          { path: PATHS.help, element: <HelpPage /> },
          { path: '*', element: <NotFoundPage area="public" /> },
        ],
      },
      {
        path: PATHS.login,
        element: (
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        ),
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              {
                path: PATHS.admin.root,
                element: <RequireRole role="ADMIN" />,
                children: [
                  { index: true, element: <AdminDashboardPage /> },
                  { path: PATHS.admin.account, element: <AccountPage /> },
                  { path: '*', element: <NotFoundPage area="app" /> },
                ],
              },
              {
                path: PATHS.staff.root,
                element: <RequireRole role="SECURITY_STAFF" />,
                children: [
                  { index: true, element: <StaffDashboardPage /> },
                  { path: PATHS.staff.account, element: <AccountPage /> },
                  { path: '*', element: <NotFoundPage area="app" /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);
