import type { ParkingSessionView } from '@cpvts/shared';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Compass,
  FileCheck,
  Info,
  LoaderCircle,
  QrCode as QrCodeIcon,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { ExitPass } from '@/components/parking/ExitPass';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { formatHour } from '@/lib/format';

import { portalApi } from './portal-api';

export function PortalCheckoutPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const [params] = useSearchParams();

  const sessionsQuery = useApiQuery(portalApi.activeSessions, { refreshIntervalMs: 8000 });
  const activeSessions = useMemo(
    () => sessionsQuery.data?.sessions ?? [],
    [sessionsQuery.data?.sessions],
  );

  const paramSessionNumber = params.get('session');
  const [userSelectedSessionNumber, setUserSelectedSessionNumber] = useState<string | null>(null);

  const selectedSessionNumber =
    userSelectedSessionNumber ||
    (paramSessionNumber && activeSessions.some((s) => s.sessionNumber === paramSessionNumber)
      ? paramSessionNumber
      : activeSessions[0]?.sessionNumber ?? '');

  const currentSession: ParkingSessionView | undefined = useMemo(
    () => activeSessions.find((s) => s.sessionNumber === selectedSessionNumber),
    [activeSessions, selectedSessionNumber],
  );

  const [exitRequestOverride, setExitRequestOverride] = useState<{
    requested: boolean;
    at: string | null;
  } | null>(null);

  const exitRequested =
    exitRequestOverride !== null
      ? exitRequestOverride.requested
      : !!currentSession?.exitRequestedAt;

  const exitRequestedAt =
    exitRequestOverride !== null
      ? exitRequestOverride.at
      : currentSession?.exitRequestedAt ?? null;

  const [exitRequesting, setExitRequesting] = useState(false);

  const quoteFetcher = useCallback(
    () => {
      if (!selectedSessionNumber) {
        return Promise.reject(new Error('No active session selected'));
      }
      return portalApi.quoteCheckout(selectedSessionNumber);
    },
    [selectedSessionNumber],
  );

  const quoteQuery = useApiQuery(quoteFetcher);
  const quote = quoteQuery.data ?? null;
  const quoteLoading = quoteQuery.status === 'loading';
  const quoteError = quoteQuery.status === 'error' ? errorMessage(t, quoteQuery.error) : null;

  const handleToggleExitRequest = async () => {
    if (!selectedSessionNumber) return;
    setExitRequesting(true);
    try {
      if (exitRequested) {
        await portalApi.cancelExitRequest(selectedSessionNumber);
        setExitRequestOverride({ requested: false, at: null });
      } else {
        const res = await portalApi.requestExit(selectedSessionNumber);
        setExitRequestOverride({ requested: true, at: res.exitRequestedAt });
      }
      sessionsQuery.reload();
    } catch {
      // Ignore background errors
    } finally {
      setExitRequesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 text-xs">
          <Link to="/portal/parking">
            <ArrowLeft className="size-3.5" />
            Back to My Parking
          </Link>
        </Button>
      </div>

      <PageHeader
        title="Prepare for Exit"
        description="Gate-controlled exit verification, stay duration preview, and parking session QR"
      />

      {sessionsQuery.status === 'loading' && <LoadingState />}
      {sessionsQuery.status === 'error' && (
        <ErrorState
          description={errorMessage(t, sessionsQuery.error)}
          onRetry={sessionsQuery.refetch}
        />
      )}

      {sessionsQuery.status === 'success' && activeSessions.length === 0 && (
        <Card className="p-8 text-center border-dashed">
          <CheckCircle2 className="size-12 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold">No Active Parking Sessions</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            All your parking sessions have been checked out and finalized at the gate. You can inspect your past visits and receipts anytime.
          </p>
          <div className="flex justify-center gap-3 mt-6">
            <Button asChild variant="outline">
              <Link to="/portal/receipts">View Receipts</Link>
            </Button>
            <Button asChild>
              <Link to="/portal">Return to Dashboard</Link>
            </Button>
          </div>
        </Card>
      )}

      {activeSessions.length > 0 && currentSession && (
        <div className="space-y-6">
          {/* Multiple Sessions Selector */}
          {activeSessions.length > 1 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Select Parked Vehicle to Exit</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-3">
                  {activeSessions.map((s) => (
                    <div
                      key={s.sessionNumber}
                      onClick={() => {
                        setUserSelectedSessionNumber(s.sessionNumber);
                        setExitRequestOverride(null);
                      }}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        selectedSessionNumber === s.sessionNumber
                          ? 'border-primary bg-primary/5 font-semibold ring-1 ring-primary'
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex justify-between text-xs">
                        <span className="font-mono">{s.vehicleNumber}</span>
                        <span>Slot {s.slotCode}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground block mt-1">
                        Session #{s.sessionNumber} · {s.block.name}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Gate-Controlled Operational Rule Notice */}
          <Alert className="border-blue-500/30 bg-blue-500/10 text-blue-950 dark:text-blue-200">
            <ShieldCheck className="size-4 text-blue-600 dark:text-blue-400" />
            <AlertTitle className="text-sm font-bold">Gate-Controlled Checkout</AlertTitle>
            <AlertDescription className="text-xs">
              To guarantee parking safety and prevent unauthorized vehicle exit, checkout and payments are handled exclusively by Security Staff at the campus exit gate.
            </AlertDescription>
          </Alert>

          {/* Parking Session QR Code Card */}
          <Card className="border-border shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 pb-4 border-b">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Badge variant="outline" className="text-primary border-primary/30">
                    Exit Gate Pass
                  </Badge>
                  <CardTitle className="text-xl font-bold mt-1">
                    {currentSession.vehicleNumber}
                  </CardTitle>
                  <CardDescription>
                    {currentSession.block.name} · Slot {currentSession.slotCode}
                  </CardDescription>
                </div>
                <div className="text-right">
                  <span className="font-mono text-xs text-muted-foreground block">
                    Session #{currentSession.sessionNumber}
                  </span>
                  <Badge
                    variant={exitRequested ? 'default' : 'secondary'}
                    className="mt-1 text-[11px]"
                  >
                    {exitRequested ? 'Gate Notified: Ready to Exit' : 'Parked'}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              <div className="flex flex-col sm:flex-row items-center gap-6 justify-center p-4 bg-muted/10 rounded-xl border">
                <ExitPass
                  entryReference={currentSession.entryReference}
                  issueCode={() => portalApi.issueExitCode(currentSession.sessionNumber)}
                  qrSize={190}
                  className="w-full sm:w-64"
                />

                <div className="space-y-3 text-center sm:text-left max-w-sm">
                  <div className="flex items-center justify-center sm:justify-start gap-2 text-primary font-semibold text-sm">
                    <QrCodeIcon className="size-4" />
                    <span>Show to Security Guard</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Security Staff will scan this code using the gate camera scanner to verify vehicle identity, calculate duration, collect simulated payment, and open the boom barrier.
                  </p>

                  <div className="pt-2">
                    <Button
                      variant={exitRequested ? 'outline' : 'default'}
                      size="sm"
                      onClick={handleToggleExitRequest}
                      disabled={exitRequesting}
                      className="gap-2 text-xs w-full sm:w-auto"
                    >
                      {exitRequesting && <LoaderCircle className="size-3.5 animate-spin" />}
                      {!exitRequesting && exitRequested && <FileCheck className="size-3.5 text-emerald-600" />}
                      {!exitRequesting && !exitRequested && <Compass className="size-3.5" />}
                      {exitRequested ? 'Cancel Ready to Exit Signal' : 'Signal Gate: Ready to Exit'}
                    </Button>
                    {exitRequestedAt && (
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        Signaled ready at {format.time(exitRequestedAt)}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {quoteLoading && <LoadingState />}
              {quoteError && (
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" />
                  <AlertDescription>{quoteError}</AlertDescription>
                </Alert>
              )}

              {/* Authoritative Stay Breakdown */}
              {quote && !quoteLoading && (
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Authoritative Stay & Fee Estimate
                  </h4>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold">
                        Entry Hour
                      </span>
                      <p className="text-sm font-bold font-mono mt-0.5">
                        {formatHour(quote.session.entryHour)}
                      </p>
                    </div>

                    <div className="rounded-lg border bg-muted/20 p-3">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold">
                        Estimated Exit
                      </span>
                      <p className="text-sm font-bold font-mono mt-0.5">
                        {formatHour(quote.exitHour)}
                      </p>
                    </div>

                    <div className="rounded-lg border bg-muted/20 p-3">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold">
                        Duration
                      </span>
                      <p className="text-sm font-bold font-mono mt-0.5 text-primary">
                        {quote.durationHours} hr(s)
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
                    <div className="space-y-1.5 text-sm">
                      {quote.fee.lines.map((line, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs">
                          <span className="text-muted-foreground">
                            {line.kind === 'FREE'
                              ? `${line.hours} hour(s) free allowance`
                              : `${line.hours} hour(s) @ ${format.paise(line.ratePaise)}/hr`}
                          </span>
                          <span className="font-mono font-medium">
                            {line.kind === 'FREE' ? 'FREE' : format.paise(line.amountPaise)}
                          </span>
                        </div>
                      ))}
                      <div className="border-t pt-2 flex justify-between items-baseline font-bold text-sm">
                        <span>Total Due at Exit Gate</span>
                        <span className="font-mono text-lg text-emerald-600 dark:text-emerald-400">
                          {format.paise(quote.fee.totalPaise)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Info className="size-3.5 text-muted-foreground shrink-0" />
                    Payment is made directly at the gate via simulated UPI, Card, or Cash. Your receipt will appear in your Receipts tab immediately following gate confirmation.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
