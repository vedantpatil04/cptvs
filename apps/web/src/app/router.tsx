import { createBrowserRouter } from 'react-router';

import { AppShell } from '@/components/layout/AppShell';
import { AccountPage } from '@/features/account/AccountPage';
import { AdminCashPage } from '@/features/admin/AdminCashPage';
import { AdminShiftsPage } from '@/features/admin/AdminShiftsPage';
import { AdminUsersPage } from '@/features/admin/AdminUsersPage';
import { AnalyticsPage } from '@/features/admin/AnalyticsPage';
import { AuditLogPage } from '@/features/admin/AuditLogPage';
import { HistoryPage } from '@/features/admin/HistoryPage';
import { IntegrityPage } from '@/features/admin/IntegrityPage';
import { ReportsPage } from '@/features/admin/ReportsPage';
import { SlotManagementPage } from '@/features/admin/SlotManagementPage';
import { PublicOnlyRoute, RequireAuth, RequireRole } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { AdminDashboardPage } from '@/features/dashboard/AdminDashboardPage';
import { StaffDashboardPage } from '@/features/dashboard/StaffDashboardPage';
import { LiveParkingPage } from '@/features/parking/LiveParkingPage';
import { ReceiptPage } from '@/features/parking/ReceiptPage';
import { SessionPage } from '@/features/parking/SessionPage';
import { VehicleEntryPage } from '@/features/parking/VehicleEntryPage';
import { VehicleExitPage } from '@/features/parking/VehicleExitPage';
import { VehicleFinderPage } from '@/features/parking/VehicleFinderPage';
import { MyParkingPage } from '@/features/portal/MyParkingPage';
import { MyVehiclesPage } from '@/features/portal/MyVehiclesPage';
import { ParkNowPage } from '@/features/portal/ParkNowPage';
import { PortalCheckoutPage } from '@/features/portal/PortalCheckoutPage';
import { PortalHistoryPage } from '@/features/portal/PortalHistoryPage';
import { PortalHomePage } from '@/features/portal/PortalHomePage';
import { PortalParkingPage } from '@/features/portal/PortalParkingPage';
import { PortalReceiptDetailPage } from '@/features/portal/PortalReceiptDetailPage';
import { PortalReceiptsPage } from '@/features/portal/PortalReceiptsPage';
import { ProfilePage } from '@/features/portal/ProfilePage';
import { VehicleLocatorPage } from '@/features/portal/VehicleLocatorPage';
import { HelpPage } from '@/features/public/HelpPage';
import { PublicHomePage } from '@/features/public/PublicHomePage';
import { PublicLayout } from '@/features/public/PublicLayout';
import { ReceiptVerificationPage } from '@/features/public/ReceiptVerificationPage';
import { VisitorAccessPage } from '@/features/visitor/VisitorAccessPage';
import { VisitorCheckoutPage } from '@/features/visitor/VisitorCheckoutPage';
import { VisitorParkingPage } from '@/features/visitor/VisitorParkingPage';
import { VisitorReceiptPage } from '@/features/visitor/VisitorReceiptPage';

import { NotFoundPage } from './pages/NotFoundPage';
import { RouteErrorPage } from './pages/RouteErrorPage';
import { PATHS } from './paths';

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
          { path: PATHS.visitor.root, element: <VisitorAccessPage /> },
          { path: PATHS.visitor.parking, element: <VisitorParkingPage /> },
          { path: PATHS.visitor.checkout, element: <VisitorCheckoutPage /> },
          { path: PATHS.visitor.receipt, element: <VisitorReceiptPage /> },
          { path: PATHS.register.root, element: <RegisterPage /> },
          { path: PATHS.register.student, element: <RegisterPage /> },
          { path: PATHS.register.staff, element: <RegisterPage /> },
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
                path: PATHS.portal.root,
                element: <RequireRole role="PARKING_USER" />,
                children: [
                  { index: true, element: <PortalHomePage /> },
                  { path: PATHS.portal.parkNow, element: <ParkNowPage /> },
                  { path: PATHS.portal.myParking, element: <MyParkingPage /> },
                  { path: PATHS.portal.checkout, element: <PortalCheckoutPage /> },
                  { path: PATHS.portal.locator, element: <VehicleLocatorPage /> },
                  { path: PATHS.portal.vehicles, element: <MyVehiclesPage /> },
                  { path: PATHS.portal.parking, element: <PortalParkingPage /> },
                  { path: PATHS.portal.history, element: <PortalHistoryPage /> },
                  { path: PATHS.portal.receipts, element: <PortalReceiptsPage /> },
                  { path: PATHS.portal.receiptDetail, element: <PortalReceiptDetailPage /> },
                  { path: PATHS.portal.profile, element: <ProfilePage /> },
                  { path: '*', element: <NotFoundPage area="app" /> },
                ],
              },
              {
                path: PATHS.admin.root,
                element: <RequireRole role="ADMIN" />,
                children: [
                  { index: true, element: <AdminDashboardPage /> },
                  { path: PATHS.admin.users, element: <AdminUsersPage /> },
                  { path: PATHS.admin.live, element: <LiveParkingPage /> },
                  { path: PATHS.admin.finder, element: <VehicleFinderPage /> },
                  { path: PATHS.admin.session, element: <SessionPage /> },
                  { path: PATHS.admin.receipt, element: <ReceiptPage /> },
                  { path: PATHS.admin.slots, element: <SlotManagementPage /> },
                  { path: PATHS.admin.shifts, element: <AdminShiftsPage /> },
                  { path: PATHS.admin.cash, element: <AdminCashPage /> },
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
