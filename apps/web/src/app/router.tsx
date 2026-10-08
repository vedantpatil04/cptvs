import { createBrowserRouter, Outlet, ScrollRestoration } from 'react-router';

import { AppShell } from '@/components/layout/AppShell';
import { UserShell } from '@/components/layout/UserShell';
import { AccountPage } from '@/features/account/AccountPage';
import { AnalyticsPage } from '@/features/admin/AnalyticsPage';
import { AuditLogPage } from '@/features/admin/AuditLogPage';
import { HistoryPage } from '@/features/admin/HistoryPage';
import { IntegrityPage } from '@/features/admin/IntegrityPage';
import { ReportsPage } from '@/features/admin/ReportsPage';
import { SlotManagementPage } from '@/features/admin/SlotManagementPage';
import { UserDetailPage } from '@/features/admin/UserDetailPage';
import { UsersPage } from '@/features/admin/UsersPage';
import {
  PublicOnlyRoute,
  RequireAuth,
  RequireOperational,
  RequireRole,
  RequireVerified,
} from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { UserLoginPage } from '@/features/auth/UserLoginPage';
import { AdminDashboardPage } from '@/features/dashboard/AdminDashboardPage';
import { StaffDashboardPage } from '@/features/dashboard/StaffDashboardPage';
import { LiveParkingPage } from '@/features/parking/LiveParkingPage';
import { ReceiptPage } from '@/features/parking/ReceiptPage';
import { SessionPage } from '@/features/parking/SessionPage';
import { VehicleEntryPage } from '@/features/parking/VehicleEntryPage';
import { VehicleExitPage } from '@/features/parking/VehicleExitPage';
import { VehicleFinderPage } from '@/features/parking/VehicleFinderPage';
import { RegisterPage } from '@/features/registration/RegisterPage';
import { AvailabilityPage } from '@/features/user/AvailabilityPage';
import { LocatePage } from '@/features/user/LocatePage';
import { MorePage } from '@/features/user/MorePage';
import { MyParkingPage } from '@/features/user/MyParkingPage';
import { ProfilePage } from '@/features/user/ProfilePage';
import { ReceiptsPage, UserReceiptPage } from '@/features/user/ReceiptsPage';
import { UserHistoryPage } from '@/features/user/UserHistoryPage';
import { UserHomePage } from '@/features/user/UserHomePage';
import { UserSessionPage } from '@/features/user/UserSessionPage';
import { VehiclesPage } from '@/features/user/VehiclesPage';
import { VisitorLayout } from '@/features/visitor/VisitorLayout';
import {
  VisitorAccessPage,
  VisitorParkingPage,
  VisitorReceiptPage,
} from '@/features/visitor/VisitorPages';
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
 *   /login       Administrator / Security Staff sign-in
 *   /user/login  Student / Campus Staff sign-in
 *   /register/*  Student / Campus Staff registration
 *   /visitor/*   visitor access to ONE parking session (no account)
 *   /user/*      PARKING_USER (Student / Campus Staff); parking pages need verification
 *   /admin/*     ADMIN only        ┐ require sign-in; unauthenticated
 *   /staff/*     SECURITY_STAFF    ┘ visitors are redirected to /login
 *   *            public "not found"
 */
/** Scrolls to the top on every new page (and restores the position when going back). */
function RootLayout() {
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
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
        path: PATHS.userLogin,
        element: (
          <PublicOnlyRoute>
            <UserLoginPage />
          </PublicOnlyRoute>
        ),
      },
      {
        path: PATHS.register,
        element: (
          <PublicOnlyRoute>
            <RegisterPage />
          </PublicOnlyRoute>
        ),
      },
      {
        path: PATHS.visitor.root,
        element: <VisitorLayout />,
        children: [
          { index: true, element: <VisitorAccessPage /> },
          { path: PATHS.visitor.parking, element: <VisitorParkingPage /> },
          { path: PATHS.visitor.receipt, element: <VisitorReceiptPage /> },
          { path: '*', element: <NotFoundPage area="public" /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireOperational />,
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
                      { path: PATHS.admin.users, element: <UsersPage /> },
                      { path: PATHS.admin.user, element: <UserDetailPage /> },
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
          {
            path: PATHS.user.root,
            element: <RequireRole role="PARKING_USER" />,
            children: [
              {
                element: <UserShell />,
                children: [
                  {
                    element: <RequireVerified />,
                    children: [
                      { index: true, element: <UserHomePage /> },
                      { path: PATHS.user.myParking, element: <MyParkingPage /> },
                      { path: PATHS.user.locate, element: <LocatePage /> },
                      { path: PATHS.user.vehicles, element: <VehiclesPage /> },
                      { path: PATHS.user.availability, element: <AvailabilityPage /> },
                      { path: PATHS.user.history, element: <UserHistoryPage /> },
                      { path: PATHS.user.session, element: <UserSessionPage /> },
                      { path: PATHS.user.receipts, element: <ReceiptsPage /> },
                      { path: PATHS.user.receipt, element: <UserReceiptPage /> },
                    ],
                  },
                  { path: PATHS.user.profile, element: <ProfilePage /> },
                  { path: PATHS.user.more, element: <MorePage /> },
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
