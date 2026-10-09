import { CreditCard, RefreshCw } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { BlockMapLink } from '@/components/parking/BlockMapLink';
import { SessionTimer } from '@/components/parking/SessionTimer';
import { VisualParkingLayout } from '@/components/parking/VisualParkingLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useApiQuery } from '@/hooks/use-api-query';
import { errorMessage } from '@/lib/error-message';

import { visitorApi } from './visitor-api';
import { visitorSessionStore } from './visitor-session';

export function VisitorParkingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const token = visitorSessionStore.get();

  const fetcher = useCallback(() => {
    if (!token) {
      return Promise.reject(new Error('No visitor token'));
    }
    return Promise.all([visitorApi.session(token), visitorApi.layout(token)]);
  }, [token]);
  const query = useApiQuery(fetcher, { refreshIntervalMs: 15_000 });

  useEffect(() => {
    if (!token) {
      navigate('/visitor');
    }
  }, [token, navigate]);

  if (!token) {
    return null;
  }

  const [session, layout] = query.data ?? [null, null];
  const loading = query.status === 'loading';
  const error = query.status === 'error' ? errorMessage(t, query.error) : null;

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-primary">
            Visitor Pass
          </span>
          <h1 className="text-2xl font-black tracking-tight text-foreground">
            Visitor Parking Details
          </h1>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={query.reload} className="gap-1.5">
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              visitorSessionStore.clear();
              navigate('/visitor');
            }}
          >
            Exit Slip
          </Button>
        </div>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState description={error} onRetry={query.refetch} />}

      {session && !loading && (
        <div className="space-y-6">
          {/* Main Visitor Vehicle Card */}
          <Card className="border-primary/40 bg-gradient-to-br from-primary/10 via-card to-card p-6 shadow-md">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge className="bg-primary text-primary-foreground font-semibold">
                    VISITOR SESSION
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    #{session.sessionNumber}
                  </span>
                </div>

                <div>
                  <span className="font-mono text-4xl font-black text-foreground tracking-tight">
                    {session.vehicleNumber}
                  </span>
                  <p className="text-sm font-medium text-muted-foreground mt-1">
                    Parked in <strong className="text-foreground">{session.block.name}</strong> ·
                    Slot{' '}
                    <strong className="text-primary font-mono text-xl">{session.slotCode}</strong>
                  </p>
                </div>

                <SessionTimer session={session} onStale={query.reload} />
              </div>

              <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0">
                {session.block.coordinates && (
                  <BlockMapLink coordinates={session.block.coordinates} />
                )}
                <Button
                  asChild
                  size="lg"
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  <Link to="/visitor/checkout">
                    <CreditCard className="size-4" />
                    Ready to leave
                  </Link>
                </Button>
              </div>
            </div>
          </Card>

          {/* Parking Layout */}
          {layout && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold tracking-tight">Your Parking Space on Campus</h3>
                  <p className="text-xs text-muted-foreground">
                    Highlighted below is your exact assigned bay in {session.block.name}.
                  </p>
                </div>
                <Badge className="font-mono bg-primary text-primary-foreground font-bold">
                  {session.slotCode}
                </Badge>
              </div>

              <VisualParkingLayout
                blocks={layout.blocks}
                userSlotCodes={[session.slotCode]}
                highlightSlot={session.slotCode}
                informationalClick={true}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
