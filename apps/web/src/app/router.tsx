import { createBrowserRouter } from 'react-router';

import { AppShell } from '@/components/layout/AppShell';
import { AccountPage } from '@/features/account/AccountPage';
import {
  PublicOnlyRoute,
  RequireAuth,
  RequireRole,
  RoleHomeRedirect,
} from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { AdminDashboardPage } from '@/features/dashboard/AdminDashboardPage';
import { StaffDashboardPage } from '@/features/dashboard/StaffDashboardPage';

import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorPage } from './pages/RouteErrorPage';
import { PATHS } from './paths';

/**
 * Route tree:
 *   /login                public (redirects signed-in users)
 *   /                     → role home
 *   /admin/*              ADMIN only
 *   /staff/*              SECURITY_STAFF only
 * Every authenticated route renders inside the AppShell.
 */
export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
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
          { index: true, element: <RoleHomeRedirect /> },
          {
            element: <AppShell />,
            children: [
              {
                path: PATHS.admin.root,
                element: <RequireRole role="ADMIN" />,
                children: [
                  { index: true, element: <AdminDashboardPage /> },
                  { path: PATHS.admin.account, element: <AccountPage /> },
                ],
              },
              {
                path: PATHS.staff.root,
                element: <RequireRole role="SECURITY_STAFF" />,
                children: [
                  { index: true, element: <StaffDashboardPage /> },
                  { path: PATHS.staff.account, element: <AccountPage /> },
                ],
              },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
