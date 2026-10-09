import {
  Bike,
  Car,
  ParkingCircle,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { VisualParkingLayout } from '@/components/parking/VisualParkingLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';

import { portalApi } from './portal-api';

export function PortalParkingPage() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const [params] = useSearchParams();

  const layoutQuery = useApiQuery(portalApi.layout, { refreshIntervalMs: 25_000 });
  const overviewQuery = useApiQuery(portalApi.overview, { refreshIntervalMs: 25_000 });

  const highlightSlot = params.get('slot');
  const isVerified = user.parkingUser?.verificationStatus === 'VERIFIED';

  const userSlots = layoutQuery.data?.mySlots ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Parking Availability"
        description="Real-time occupancy across all campus blocks and zones"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                layoutQuery.reload();
                overviewQuery.reload();
              }}
            >
              <RefreshCw className="size-4" aria-hidden />
              Refresh
            </Button>

            {isVerified && (
              <Button asChild size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                <Link to="/portal/park-now">
                  <ParkingCircle className="size-4" />
                  Park My Vehicle
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {(layoutQuery.status === 'loading' || overviewQuery.status === 'loading') && <LoadingState />}
      {(layoutQuery.status === 'error' || overviewQuery.status === 'error') && (
        <ErrorState
          description={errorMessage(t, layoutQuery.error || overviewQuery.error)}
          onRetry={() => {
            layoutQuery.refetch();
            overviewQuery.refetch();
          }}
        />
      )}

      {layoutQuery.status === 'success' && overviewQuery.status === 'success' && (
        <div className="space-y-8">
          {/* Prominent Live Availability Summary Cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {overviewQuery.data.availability.map((avail) => {
              const Icon = avail.vehicleType === 'TWO_WHEELER' ? Bike : Car;
              const percent =
                avail.totalSlots > 0
                  ? Math.round((avail.availableSlots / avail.totalSlots) * 100)
                  : 0;

              return (
                <Card key={avail.vehicleType} className="p-4 border shadow-xs">
                  <div className="flex items-center justify-between pb-2">
                    <div className="flex items-center gap-2">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-4" />
                      </div>
                      <span className="text-xs font-bold uppercase tracking-wider">
                        {t(`vehicleTypes.${avail.vehicleType}`)}
                      </span>
                    </div>
                    <Badge variant="outline" className="font-mono text-xs">
                      {percent}% Free
                    </Badge>
                  </div>

                  <div className="space-y-2 mt-2">
                    <div className="flex justify-between items-baseline">
                      <span className="text-2xl font-black font-mono">
                        {avail.availableSlots}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        of {avail.totalSlots} spaces free
                      </span>
                    </div>

                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                </Card>
              );
            })}

            {/* Quick Action Card to Park */}
            <Card className="sm:col-span-2 p-4 border-primary/30 bg-primary/5 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  Ready to Park?
                </span>
                <p className="text-xs text-muted-foreground">
                  CPVTS automatically assigns the optimal available bay for your vehicle.
                </p>
              </div>
              <Button asChild className="gap-2 shrink-0 bg-primary shadow-xs">
                <Link to="/portal/park-now">
                  <ParkingCircle className="size-4" />
                  Park My Vehicle
                </Link>
              </Button>
            </Card>
          </div>

          {/* Interactive Layout Component */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold tracking-tight">Interactive Campus Layout</h3>
                <p className="text-xs text-muted-foreground">
                  Click any stall for details. CPVTS automatically selects the best valid slot when
                  you park.
                </p>
              </div>

              {highlightSlot && (
                <Badge variant="outline" className="font-mono text-primary border-primary">
                  Highlighting: {highlightSlot}
                </Badge>
              )}
            </div>

            <VisualParkingLayout
              blocks={layoutQuery.data.blocks}
              userSlotCodes={userSlots}
              highlightSlot={highlightSlot}
              informationalClick={true}
            />
          </div>
        </div>
      )}
    </div>
  );
}
