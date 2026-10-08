import { createBrowserRouter } from 'react-router';

import { AppShell } from '@/components/layout/AppShell';
import { AccountPage } from '@/features/account/AccountPage';
import { AnalyticsPage } from '@/features/admin/AnalyticsPage';
import { AuditLogPage } from '@/features/admin/AuditLogPage';
import { HistoryPage } from '@/features/admin/HistoryPage';
import { IntegrityPage } from '@/features/admin/IntegrityPage';
import { ReportsPage } from '@/features/admin/ReportsPage';
import { SlotManagementPage } from '@/features/admin/SlotManagementPage';
import { PublicOnlyRoute, RequireAuth, RequireRole } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { AdminDashboardPage } from '@/features/dashboard/AdminDashboardPage';
import { StaffDashboardPage } from '@/features/dashboard/StaffDashboardPage';
import { LiveParkingPage } from '@/features/parking/LiveParkingPage';
import { ReceiptPage } from '@/features/parking/ReceiptPage';
import { SessionPage } from '@/features/parking/SessionPage';
import { VehicleEntryPage } from '@/features/parking/VehicleEntryPage';
import { VehicleExitPage } from '@/features/parking/VehicleExitPage';
import { VehicleFinderPage } from '@/features/parking/VehicleFinderPage';
import { HelpPage } from '@/features/public/HelpPage';
import { PublicHomePage } from '@/features/public/PublicHomePage';
import { PublicLayout } from '@/features/public/PublicLayout';
import { ReceiptVerificationPage } from '@/features/public/ReceiptVerificationPage';

import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorPage } from './pages/RouteErrorPage';
import { PATHS } from './paths';

/**
 * Route tree:
 *   /            public landing page (aggregate parking overview, no sign-in)
 *   /help        public Help & FAQ
 *   /verify/:ref public receipt QR verification (shows only the receipt it identifies)
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
          { path: PATHS.verify, element: <ReceiptVerificationPage /> },
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
                  { path: PATHS.admin.live, element: <LiveParkingPage /> },
                  { path: PATHS.admin.finder, element: <VehicleFinderPage /> },
                  { path: PATHS.admin.session, element: <SessionPage /> },
                  { path: PATHS.admin.receipt, element: <ReceiptPage /> },
                  { path: PATHS.admin.slots, element: <SlotManagementPage /> },
                  { path: PATHS.admin.history, element: <HistoryPage /> },
                  { path: PATHS.admin.analytics, element: <AnalyticsPage /> },
                  { path: PATHS.admin.reports, element: <ReportsPage /> },
                  { path: PATHS.admin.integrity, element: <IntegrityPage /> },
                  { path: PATHS.admin.auditLogs, element: <AuditLogPage /> },
                  { path: PATHS.admin.account, element: <AccountPage /> },
                  { path: '*', element: <NotFoundPage area="app" /> },
                ],
              },
              {
                path: PATHS.staff.root,
                element: <RequireRole role="SECURITY_STAFF" />,
                children: [
                  { index: true, element: <StaffDashboardPage /> },
                  { path: PATHS.staff.entry, element: <VehicleEntryPage /> },
                  { path: PATHS.staff.exit, element: <VehicleExitPage /> },
                  { path: PATHS.staff.live, element: <LiveParkingPage /> },
                  { path: PATHS.staff.finder, element: <VehicleFinderPage /> },
                  { path: PATHS.staff.session, element: <SessionPage /> },
                  { path: PATHS.staff.receipt, element: <ReceiptPage /> },
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
