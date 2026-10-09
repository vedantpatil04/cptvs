import type { CheckoutQuote } from '@cpvts/shared';
import { entryQrPayload } from '@cpvts/shared';
import {
  ArrowLeft,
  FileCheck,
  Info,
  LoaderCircle,
  QrCode as QrCodeIcon,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { QrCode } from '@/components/parking/QrCode';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { formatHour } from '@/lib/format';

import { visitorApi } from './visitor-api';
import { visitorSessionStore } from './visitor-session';

export function VisitorCheckoutPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const navigate = useNavigate();

  const token = visitorSessionStore.get();

  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [exitRequesting, setExitRequesting] = useState(false);
  const [exitRequested, setExitRequested] = useState<boolean>(false);
  const [exitRequestedAt, setExitRequestedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/visitor');
      return;
    }

    visitorApi
      .quote(token)
      .then((q) => {
        setQuote(q);
        if (q.session.lifecycle === 'COMPLETED') {
          navigate('/visitor/receipt');
        }
        if (q.session.exitRequestedAt) {
          setExitRequested(true);
          setExitRequestedAt(q.session.exitRequestedAt);
        }
      })
      .catch((err) => setError(errorMessage(t, err)))
      .finally(() => setLoading(false));
  }, [token, navigate, t]);

  const handleToggleExitRequest = async () => {
    if (!token) return;
    setExitRequesting(true);
    try {
      if (exitRequested) {
        await visitorApi.cancelExitRequest(token);
        setExitRequested(false);
        setExitRequestedAt(null);
      } else {
        const res = await visitorApi.requestExit(token);
        setExitRequested(true);
        setExitRequestedAt(res.exitRequestedAt);
      }
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setExitRequesting(false);
    }
  };

  if (!token) return null;

  const qrValue = quote?.session.entryReference
    ? entryQrPayload(quote.session.entryReference)
    : quote?.session.sessionNumber ?? '';

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6 space-y-6">
      <div className="mb-2">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 text-xs">
          <Link to="/visitor/parking">
            <ArrowLeft className="size-3.5" />
            Back to Parking Details
          </Link>
        </Button>
      </div>

      <PageHeader
        title="Prepare for Exit"
        description="Gate-controlled exit verification, stay duration preview, and visitor parking QR"
      />

      {loading && <LoadingState />}
      {error && <ErrorState description={error} onRetry={() => window.location.reload()} />}

      {quote && !loading && (
        <div className="space-y-6">
          {/* Gate-Controlled Operational Rule Notice */}
          <Alert className="border-blue-500/30 bg-blue-500/10 text-blue-950 dark:text-blue-200">
            <ShieldCheck className="size-4 text-blue-600 dark:text-blue-400" />
            <AlertTitle className="text-sm font-bold">Gate-Controlled Checkout</AlertTitle>
            <AlertDescription className="text-xs">
              Visitor checkout is finalized by Security Staff at the exit gate. Show your Parking QR code at the gate to complete checkout, pay, and obtain your receipt.
            </AlertDescription>
          </Alert>

          {/* Visitor Pass Card */}
          <Card className="border-border shadow-md overflow-hidden">
            <CardHeader className="bg-muted/30 pb-4 border-b">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Badge variant="outline" className="text-primary border-primary/30">
                    Visitor Exit Gate Pass
                  </Badge>
                  <CardTitle className="text-xl font-bold mt-1">
                    {quote.session.vehicleNumber}
                  </CardTitle>
                  <CardDescription>
                    {quote.session.block.name} · Slot {quote.session.slotCode}
                  </CardDescription>
                </div>
                <div className="text-right">
                  <span className="font-mono text-xs text-muted-foreground block">
                    Session #{quote.session.sessionNumber}
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
              {/* QR Display */}
              <div className="flex flex-col sm:flex-row items-center gap-6 justify-center p-4 bg-muted/10 rounded-xl border">
                <div className="p-3 bg-white rounded-xl shadow-xs border">
                  <QrCode
                    value={qrValue}
                    label={`Visitor Parking Session QR for ${quote.session.vehicleNumber}`}
                    size={190}
                  />
                </div>

                <div className="space-y-3 text-center sm:text-left max-w-sm">
                  <div className="flex items-center justify-center sm:justify-start gap-2 text-primary font-semibold text-sm">
                    <QrCodeIcon className="size-4" />
                    <span>Show to Security Guard</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Present this QR code to campus Security Staff at the gate. The camera scanner will confirm vehicle details, record your stay, and open the gate.
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

              {/* Authoritative Stay Breakdown */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Stay Timing & Authoritative Fee
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
                      Exit Hour
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
                  Payment can be made at the exit gate via simulated UPI, Card, or Cash. Your receipt will become available immediately upon gate finalization.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
