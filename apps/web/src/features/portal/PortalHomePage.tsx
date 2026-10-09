import {
  ArrowRight,
  Bike,
  Car,
  CheckCircle2,
  Clock,
  Compass,
  CreditCard,
  MapPin,
  ParkingCircle,
  Plus,
  Receipt,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth, useCurrentUser } from '@/features/auth/use-auth';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';

import { portalApi } from './portal-api';

export function PortalHomePage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const { user } = useCurrentUser();
  const { refreshUser } = useAuth();

  const overviewQuery = useApiQuery(portalApi.overview, { refreshIntervalMs: 15_000 });
  const vehiclesQuery = useApiQuery(portalApi.vehicles, { refreshIntervalMs: 15_000 });
  const profileQuery = useApiQuery(portalApi.profile);

  const profileVerificationStatus = profileQuery.data?.verification.status;
  const verificationStatus =
    (profileVerificationStatus === 'VERIFIED' ? 'VERIFIED' : null) ??
    user.parkingUser?.verificationStatus ??
    profileVerificationStatus;
  const isPending = verificationStatus === 'PENDING';
  const isRejected = verificationStatus === 'REJECTED';
  const isVerified = verificationStatus === 'VERIFIED';

  useEffect(() => {
    if (
      profileVerificationStatus &&
      profileVerificationStatus !== user.parkingUser?.verificationStatus
    ) {
      void refreshUser();
    }
  }, [profileVerificationStatus, user.parkingUser?.verificationStatus, refreshUser]);

  const vehicles = vehiclesQuery.data?.vehicles ?? [];
  const overview = overviewQuery.data;
  const activeSessions = overview?.activeSessions ?? [];
  const primaryActive = activeSessions[0];

  const recentCompleted = overview?.recentActivity.filter((item) => item.status === 'COMPLETED')[0];

  const homeState: 1 | 2 | 3 | 4 | 5 = vehicles.length === 0
    ? 1
    : primaryActive
      ? 3
      : recentCompleted
        ? 5
        : 2;


  const roleName = user.parkingUser?.category === 'STAFF' ? 'Staff' : 'Student';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user.fullName}`}
        description={`${roleName} Parking Portal · Single source of truth for parking on campus`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              overviewQuery.reload();
              vehiclesQuery.reload();
              profileQuery.reload();
              void refreshUser();
            }}
          >
            <RefreshCw className="size-4" aria-hidden />
            Refresh
          </Button>
        }
      />

      {/* Verification alerts */}
      {isPending && (
        <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">
          <Clock className="size-5 text-amber-600 dark:text-amber-400" />
          <AlertTitle className="font-semibold">Identity Verification In Progress</AlertTitle>
          <AlertDescription className="text-sm">
            Institutional identity verification is required before you can park.
          </AlertDescription>
        </Alert>
      )}

      {isVerified && (
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-xs bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 w-fit">
          <CheckCircle2 className="size-4" />
          <span>✓ Institutional identity verified</span>
        </div>
      )}

      {isRejected && (
        <Alert variant="destructive">
          <ShieldAlert className="size-5" />
          <AlertTitle className="font-semibold">Verification Document Needs Attention</AlertTitle>
          <AlertDescription className="text-sm space-y-2">
            <p>
              Your identity document was not approved.
              {profileQuery.data?.verification?.note && (
                <span className="font-medium block mt-1">
                  Reason: {profileQuery.data.verification.note}
                </span>
              )}
            </p>
            <Button size="sm" variant="outline" asChild className="bg-background mt-2">
              <Link to="/portal/profile">Resubmit Document in Profile</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Loading & error states */}
      {(overviewQuery.status === 'loading' || vehiclesQuery.status === 'loading') && (
        <LoadingState />
      )}
      {(overviewQuery.status === 'error' || vehiclesQuery.status === 'error') && (
        <ErrorState
          description={errorMessage(t, overviewQuery.error || vehiclesQuery.error)}
          onRetry={() => {
            overviewQuery.refetch();
            vehiclesQuery.refetch();
          }}
        />
      )}

      {/* Primary Action Card based on Home State */}
      {overviewQuery.status === 'success' && vehiclesQuery.status === 'success' && (
        <div className="grid gap-6">
          {/* STATE 1: No Vehicle */}
          {homeState === 1 && (
            <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <Badge variant="outline" className="text-primary border-primary/30">
                    Step 1 of Parking
                  </Badge>
                  <h2 className="text-2xl font-bold tracking-tight">Add Your First Vehicle</h2>
                  <p className="text-muted-foreground text-sm max-w-xl">
                    Register your two-wheeler or four-wheeler plate to start parking. Vehicles are
                    validated against your verified institutional profile.
                  </p>
                </div>
                <Button size="lg" asChild className="gap-2 shrink-0">
                  <Link to="/portal/vehicles">
                    <Plus className="size-4" />
                    Add Vehicle
                  </Link>
                </Button>
              </div>
            </Card>
          )}

          {/* STATE 2: Vehicle Exists, Not Parked */}
          {homeState === 2 && (
            <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-card to-card p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                      Ready to Park
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {vehicles.length} vehicle(s) registered
                    </span>
                  </div>
                  <h2 className="text-2xl font-bold tracking-tight">Need a Parking Space?</h2>
                  <p className="text-muted-foreground text-sm max-w-xl">
                    Use Park Now to allocate the best available slot instantly. CPVTS automatically
                    checks availability, zone rules, and holds your space.
                  </p>
                </div>
                <Button
                  size="lg"
                  asChild
                  disabled={!isVerified}
                  className="gap-2 shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
                >
                  <Link to="/portal/park-now">
                    <ParkingCircle className="size-5" />
                    Park Now
                  </Link>
                </Button>
              </div>
            </Card>
          )}

          {/* STATE 3: Vehicle Currently Parked */}
          {homeState === 3 && primaryActive && (
            <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-6 shadow-md ring-1 ring-primary/20">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="relative flex size-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider text-primary">
                      Actively Parked
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      #{primaryActive.sessionNumber}
                    </span>
                  </div>

                  <div>
                    <h2 className="text-3xl font-extrabold tracking-tight font-mono">
                      {primaryActive.vehicleNumber}
                    </h2>
                    <p className="text-sm font-medium text-muted-foreground mt-0.5">
                      Parked in <strong className="text-foreground">{primaryActive.block.name}</strong> · Slot{' '}
                      <strong className="text-primary font-mono text-base">{primaryActive.slotCode}</strong>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                    <div className="rounded-lg border bg-background/60 p-2.5">
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                        Entry Time
                      </span>
                      <p className="text-sm font-bold">{format.time(primaryActive.entryAt)}</p>
                    </div>
                    <div className="rounded-lg border bg-background/60 p-2.5">
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                        Duration
                      </span>
                      <p className="text-sm font-bold">
                        {primaryActive.currentDurationHours ?? 0} hr(s)
                      </p>
                    </div>
                    <div className="rounded-lg border bg-background/60 p-2.5 col-span-2 sm:col-span-1">
                      <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                        Current Fee
                      </span>
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {primaryActive.estimatedFee
                          ? format.paise(primaryActive.estimatedFee.totalPaise)
                          : '₹0'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0">
                  <Button size="lg" asChild className="gap-2">
                    <Link to="/portal/locate">
                      <Compass className="size-4" />
                      Locate My Vehicle
                    </Link>
                  </Button>
                  <Button variant="outline" size="lg" asChild className="gap-2">
                    <Link to={`/portal/checkout?session=${encodeURIComponent(primaryActive.sessionNumber)}`}>
                      <CreditCard className="size-4" />
                      Check Out
                    </Link>
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* STATE 5: Recently Completed */}
          {homeState === 5 && recentCompleted && (
            <Card className="border-border bg-card p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-4" />
                    <span className="text-xs font-semibold uppercase tracking-wider">
                      Recent Parking Completed
                    </span>
                  </div>
                  <h2 className="text-xl font-bold tracking-tight">
                    Session for {recentCompleted.vehicleNumber} Closed
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Duration: {recentCompleted.durationHours ?? 0} hr(s) · Fee:{' '}
                    {recentCompleted.feePaise ? format.paise(recentCompleted.feePaise) : '₹0'} · Slot{' '}
                    {recentCompleted.slotCode}
                  </p>
                </div>
                <div className="flex gap-2">
                  {recentCompleted.receiptNumber && (
                    <Button variant="outline" asChild className="gap-2">
                      <Link to={`/portal/receipts/${encodeURIComponent(recentCompleted.receiptNumber)}`}>
                        <Receipt className="size-4" />
                        View Receipt
                      </Link>
                    </Button>
                  )}
                  <Button asChild className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Link to="/portal/park-now">
                      <ParkingCircle className="size-4" />
                      Park Again
                    </Link>
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* Quick Actions Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Link
              to="/portal/park-now"
              className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center transition-all hover:bg-muted/50 hover:shadow-sm"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ParkingCircle className="size-5" />
              </div>
              <span className="text-xs font-semibold">Park Now</span>
            </Link>

            <Link
              to="/portal/my-parking"
              className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center transition-all hover:bg-muted/50 hover:shadow-sm"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600">
                <Compass className="size-5" />
              </div>
              <span className="text-xs font-semibold">My Parking</span>
            </Link>

            <Link
              to="/portal/vehicles"
              className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center transition-all hover:bg-muted/50 hover:shadow-sm"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600">
                <Car className="size-5" />
              </div>
              <span className="text-xs font-semibold">My Vehicles</span>
            </Link>

            <Link
              to="/portal/parking"
              className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center transition-all hover:bg-muted/50 hover:shadow-sm"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
                <MapPin className="size-5" />
              </div>
              <span className="text-xs font-semibold">Live Availability</span>
            </Link>
          </div>

          {/* Live Availability Section & Recent Activity in 2 columns */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Live Availability Widget */}
            <Card className="lg:col-span-1 shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center justify-between">
                  <span>Live Campus Spaces</span>
                  <span className="size-2 rounded-full bg-emerald-500 animate-ping" />
                </CardTitle>
                <CardDescription className="text-xs">
                  Updated in real-time from central allocation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {overview?.availability.map((avail) => {
                  const Icon = avail.vehicleType === 'TWO_WHEELER' ? Bike : Car;
                  const percent =
                    avail.totalSlots > 0
                      ? Math.round((avail.availableSlots / avail.totalSlots) * 100)
                      : 0;

                  return (
                    <div
                      key={avail.vehicleType}
                      className="rounded-lg border bg-muted/20 p-3.5 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="size-4 text-primary" />
                          <span className="text-xs font-semibold">
                            {t(`vehicleTypes.${avail.vehicleType}`)}
                          </span>
                        </div>
                        <span className="text-xs font-mono font-bold">
                          {avail.availableSlots} / {avail.totalSlots} free
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}

                <Button variant="ghost" size="sm" asChild className="w-full text-xs text-primary">
                  <Link to="/portal/parking" className="gap-1 justify-center">
                    View Interactive Layout
                    <ArrowRight className="size-3" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card className="lg:col-span-2 shadow-xs">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold">Recent Parking Activity</CardTitle>
                  <CardDescription className="text-xs">
                    Your personal stays and receipts
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild className="text-xs">
                  <Link to="/portal/history">View All</Link>
                </Button>
              </CardHeader>
              <CardContent>
                {overview?.recentActivity.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No recent parking activity.
                  </div>
                ) : (
                  <div className="divide-y text-xs">
                    {overview?.recentActivity.slice(0, 4).map((item) => (
                      <div
                        key={item.sessionNumber}
                        className="py-3 flex items-center justify-between gap-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-foreground">
                              {item.vehicleNumber}
                            </span>
                            <Badge
                              variant={item.status === 'ACTIVE' ? 'default' : 'secondary'}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {item.status === 'ACTIVE' ? 'Parked' : 'Completed'}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground text-[11px]">
                            {item.blockName} · Slot {item.slotCode} ·{' '}
                            {format.time(item.entryAt)}
                          </p>
                        </div>

                        <div className="text-right">
                          <span className="font-bold font-mono">
                            {item.feePaise ? format.paise(item.feePaise) : '₹0'}
                          </span>
                          {item.receiptNumber && (
                            <Link
                              to={`/portal/receipts/${encodeURIComponent(item.receiptNumber)}`}
                              className="block text-[11px] text-primary hover:underline"
                            >
                              Receipt
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
