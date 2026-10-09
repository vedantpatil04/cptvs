import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Car,
  Coins,
  GraduationCap,
  History,
  MapPinned,
  Search,
  Shield,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS } from '@/app/paths';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCurrentUser } from '@/features/auth/use-auth';
import { VipReservationsPanel } from '@/features/parking/VipReservationsPanel';
import { AlertsPanel } from '@/features/operations/AlertsPanel';
import { parkingApi } from '@/features/parking/parking-api';
import { adminShiftsApi } from '@/features/shifts/shifts-api';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';

import { ParkingKpis } from './ParkingKpis';
import { SystemStatusCard } from './SystemStatusCard';

export function AdminDashboardPage() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const format = useFormatters();
  const summaryQuery = useApiQuery(parkingApi.summary, { refreshIntervalMs: 30_000 });
  const cashSummaryQuery = useApiQuery(
    (signal) => adminShiftsApi.cashSummary(undefined, signal),
    { refreshIntervalMs: 30_000 },
  );
  const users = summaryQuery.data?.users;
  const recent = summaryQuery.data?.recentActivity;
  const cashData = cashSummaryQuery.data;

  return (
    <>
      <PageHeader
        title={t('dashboard.welcome', { name: user.fullName })}
        description={t('dashboard.adminDescription')}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={PATHS.admin.shifts}>
                <Calendar aria-hidden />
                Shifts
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={PATHS.admin.cash}>
                <Coins aria-hidden />
                Cash Handover
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={PATHS.admin.users}>
                <Users aria-hidden />
                {t('nav.users')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={PATHS.admin.finder}>
                <Search aria-hidden />
                {t('nav.vehicleFinder')}
              </Link>
            </Button>
            <Button asChild>
              <Link to={PATHS.admin.live}>
                <MapPinned aria-hidden />
                {t('nav.liveParking')}
              </Link>
            </Button>
          </>
        }
      />
      <div className="space-y-6">
        {/* Cash Discrepancy Alert */}
        {cashData && cashData.openDiscrepancies.length > 0 && (
          <Alert variant="destructive" className="border-destructive/40 bg-destructive/10">
            <AlertTriangle className="size-5" />
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <AlertTitle className="text-base font-semibold">
                  {cashData.openDiscrepancies.length} Cash Handover Discrepancy(ies) Pending Review
                </AlertTitle>
                <AlertDescription className="text-xs">
                  Physical cash collected by security shifts does not match expected totals. Administrative review required.
                </AlertDescription>
              </div>
              <Button asChild size="sm" variant="outline" className="self-start sm:self-auto shrink-0 border-destructive/40">
                <Link to={PATHS.admin.cash}>
                  Review Cash Handover
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
          </Alert>
        )}
        {/* Pending Verification Notice */}
        {users && users.pendingVerification > 0 && (
          <Alert variant="warning" className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
            <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400" aria-hidden />
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <AlertTitle className="text-base font-semibold">
                  {users.pendingVerification} user registration{users.pendingVerification > 1 ? 's' : ''} awaiting verification
                </AlertTitle>
                <AlertDescription className="text-xs">
                  Review submitted college ID documents and verify student or staff status.
                </AlertDescription>
              </div>
              <Button asChild size="sm" variant="outline" className="self-start sm:self-auto shrink-0 border-amber-600/40">
                <Link to={`${PATHS.admin.users}?filter=PENDING`}>
                  Review registrations
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
          </Alert>
        )}

        {/* User Community Metric Cards */}
        {users && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
                  <GraduationCap className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Students</p>
                  <p className="text-2xl font-bold tabular-nums">{users.students}</p>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
                  <Shield className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Campus Staff</p>
                  <p className="text-2xl font-bold tabular-nums">{users.staff}</p>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-muted p-2.5 text-muted-foreground">
                  <Car className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Visitor Vehicles</p>
                  <p className="text-2xl font-bold tabular-nums">{users.visitorVehicles}</p>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-600 dark:text-emerald-400">
                  <Users className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Currently Parked Users</p>
                  <p className="text-2xl font-bold tabular-nums">
                    {users.activeParkingUsers + users.activeVisitors}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Parking Occupancy and System Status */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <ParkingKpis />
          <SystemStatusCard />
        </div>

        {/* Recent Operational Activity */}
        {recent && recent.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="size-4 text-muted-foreground" aria-hidden />
                  Recent Parking Sessions
                </CardTitle>
                <CardDescription>Live session movements across campus parking blocks</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to={PATHS.admin.history}>
                  View all history
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Bay</TableHead>
                    <TableHead>Entry Time</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.slice(0, 5).map((s) => (
                    <TableRow key={s.sessionNumber}>
                      <TableCell className="font-mono font-semibold">
                        <Link
                          to={`${PATHS.admin.root}/sessions/${s.sessionNumber}`}
                          className="hover:underline text-primary"
                        >
                          {s.vehicleNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t(`vehicleTypes.${s.vehicleType}`)}
                      </TableCell>
                      <TableCell className="font-mono font-medium">{s.slotCode}</TableCell>
                      <TableCell className="text-xs">{format.dateTime(s.entryAt)}</TableCell>
                      <TableCell className="text-xs">
                        {s.durationHours !== null ? `${s.durationHours}h` : 'Active'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={s.status === 'COMPLETED' ? 'outline' : 'secondary'}
                          className="text-[10px]"
                        >
                          {s.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {s.feePaise !== null ? format.paise(s.feePaise) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* VIP / emergency reservations: status and history (Security manages them) */}
        <VipReservationsPanel readOnly />

        {/* Real-time Alerts */}
        <AlertsPanel />
      </div>
    </>
  );
}
