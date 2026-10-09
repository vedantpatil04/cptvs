import {
  CHARGEABLE_PAYMENT_METHODS,
  type CheckoutQuote,
  type PaymentMethod,
  type PaymentView,
  type ProcessPaymentResponse,
  type ScanCheckoutResponse,
  type TrackingResponse,
} from '@cpvts/shared';
import {
  Banknote,
  Camera,
  CircleAlert,
  CircleCheck,
  CircleX,
  CreditCard,
  FlaskConical,
  KeyRound,
  LoaderCircle,
  ReceiptText,
  ScanLine,
  Search,
  Smartphone,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { areaPaths } from '@/app/paths';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { ExitCodeEntry } from '@/components/parking/ExitCodeEntry';
import { QrScanner } from '@/components/parking/QrScanner';
import { FeeBreakdownView } from '@/components/parking/FeeBreakdownView';
import { SessionDetails } from '@/components/parking/SessionDetails';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChoiceGroup, NativeSelect } from '@/components/ui/choice-group';
import { DescriptionItem, DescriptionList } from '@/components/ui/description-list';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useFormatters } from '@/hooks/use-formatters';
import { campusDateAt, campusHourAt } from '@/lib/duration';
import { errorMessage } from '@/lib/error-message';
import { formatHour, HOURS } from '@/lib/format';
import { cn } from '@/lib/utils';
import { serverNow } from '@/lib/server-clock';

import { parkingApi } from './parking-api';
import { useVehicleSearch } from './use-vehicle-search';
import { VehicleSearchForm } from './VehicleSearchForm';

const METHOD_ICONS = { UPI: Smartphone, CARD: CreditCard, CASH: Banknote } as const;

/** Minimum time each payment stage stays on screen, so operators can follow it. */
const STAGE_MS = 700;
const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

type PaymentStage = 'creating' | 'processing' | 'verifying';

type Step =
  | { name: 'review' }
  | { name: 'paying'; stage: PaymentStage; payment: PaymentView | null }
  | { name: 'done'; outcome: ProcessPaymentResponse };

type ExitSessionResult = TrackingResponse | ScanCheckoutResponse;

/** Identifiers the operator used, re-verified by the server against the session. */
const identifiersFrom = (found: ExitSessionResult) => ({
  ...(found.matchedBy === 'VEHICLE_NUMBER' ? { vehicleNumber: found.session.vehicleNumber } : {}),
  ...(found.matchedBy === 'SLOT' ? { slotCode: found.session.slotCode } : {}),
  ...(found.matchedBy === 'ENTRY_QR' && found.session.entryReference
    ? { entryReference: found.session.entryReference }
    : {}),
});

/**
 * Security Staff checkout: identify the vehicle (Parking Session QR, or the 6-digit code when
 * the QR cannot be scanned, or a manual lookup as a last resort) → the server verifies the
 * session → confirm exit hour → fee preview → test payment → receipt. Identifying a vehicle
 * never completes a checkout.
 */
export function VehicleExitPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [initialSession] = useState(() => params.get('session'));
  const { state: search, search: runSearch, clear: clearSearch } = useVehicleSearch(initialSession);

  const [scanning, setScanning] = useState(
    () => (params.get('tab') ?? params.get('mode')) === 'scan',
  );
  const [showManual, setShowManual] = useState(() => initialSession !== null);
  const [focusCode, setFocusCode] = useState(0);
  const [verified, setVerified] = useState<ScanCheckoutResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<{ via: 'qr' | 'code'; error: unknown } | null>(null);
  // Blocks a second request while one is in flight (the camera can read the same QR twice).
  const inFlight = useRef(false);

  const found: ExitSessionResult | null =
    verified ?? (search.status === 'found' ? search.result : null);

  const handleReset = () => {
    clearSearch();
    setVerified(null);
    setCheckError(null);
  };

  const verify = async (via: 'qr' | 'code', value: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    setCheckError(null);
    try {
      setVerified(
        via === 'qr' ? await parkingApi.scanCheckout(value) : await parkingApi.codeCheckout(value),
      );
    } catch (error) {
      setCheckError({ via, error });
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };

  return (
    <>
      <PageHeader title={t('parking.exit.title')} description={t('parking.exit.description')} />
      <div className="space-y-6">
        {!found && (
          <div className="max-w-5xl space-y-4">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ScanLine className="size-5 text-primary" aria-hidden />
                    {t('parking.scan.title')}
                  </CardTitle>
                  <CardDescription>{t('parking.scan.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {scanning ? (
                    <QrScanner
                      onScan={(value) => {
                        setScanning(false);
                        void verify('qr', value);
                      }}
                      onCancel={() => setScanning(false)}
                      onUseCode={() => {
                        setScanning(false);
                        setFocusCode((value) => value + 1);
                      }}
                    />
                  ) : (
                    <Button
                      size="lg"
                      className="h-14 w-full text-base"
                      disabled={checking}
                      onClick={() => {
                        setCheckError(null);
                        setScanning(true);
                      }}
                    >
                      <Camera className="size-5" aria-hidden />
                      {t('parking.scan.start')}
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <KeyRound className="size-5 text-primary" aria-hidden />
                    {t('parking.exitCode.title')}
                  </CardTitle>
                  <CardDescription>{t('parking.exitCode.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ExitCodeEntry
                    busy={checking}
                    focusSignal={focusCode}
                    onSubmit={(code) => void verify('code', code)}
                  />
                </CardContent>
              </Card>
            </div>

            <div>
              <Button
                variant="ghost"
                className="h-11 gap-2 text-muted-foreground"
                aria-expanded={showManual}
                onClick={() => setShowManual((value) => !value)}
              >
                <Search aria-hidden />
                {t('parking.exitCode.manualToggle')}
              </Button>
              {showManual && (
                <Card className="mt-2">
                  <CardContent className="pt-6">
                    <p className="mb-3 text-sm text-muted-foreground">
                      {t('parking.exitCode.manualHint')}
                    </p>
                    <VehicleSearchForm
                      onSearch={(query) => void runSearch(query)}
                      searching={search.status === 'searching'}
                      initialValue={initialSession ?? ''}
                      submitLabel={t('parking.exit.find')}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {(search.status === 'searching' || checking) && <LoadingState />}

        {search.status === 'error' && (
          <Alert variant="destructive" className="max-w-3xl">
            <CircleAlert aria-hidden />
            <AlertDescription>{errorMessage(t, search.error)}</AlertDescription>
          </Alert>
        )}

        {checkError !== null && (
          <Alert variant="destructive" className="max-w-3xl">
            <CircleAlert aria-hidden />
            <AlertTitle>
              {checkError.via === 'qr'
                ? t('parking.scan.failedTitle')
                : t('parking.exitCode.failedTitle')}
            </AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{errorMessage(t, checkError.error)}</p>
              {checkError.via === 'qr' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-10 bg-background"
                  onClick={() => {
                    setCheckError(null);
                    setScanning(true);
                  }}
                >
                  {t('parking.scan.scanAgain')}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {found && (
          <CheckoutFlow key={found.session.sessionNumber} found={found} onReset={handleReset} />
        )}
      </div>
    </>
  );
}

function CheckoutFlow({ found, onReset }: { found: ExitSessionResult; onReset: () => void }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const { session } = found;
  const verifiedBy =
    found.matchedBy === 'ENTRY_QR' || found.matchedBy === 'EXIT_CODE' ? found.matchedBy : null;
  // Start from the campus clock hour now (server-corrected), not from when the page was loaded.
  const [exitHour, setExitHour] = useState(() =>
    Math.max(session.entryHour, campusHourAt(serverNow())),
  );
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('UPI');
  const [step, setStep] = useState<Step>({ name: 'review' });
  const [error, setError] = useState<unknown>(null);
  const [quoting, setQuoting] = useState(false);

  if (session.status !== 'ACTIVE') {
    return <CompletedSessionNotice receiptNumber={session.receiptNumber} onReset={onReset} />;
  }

  const identifiers = identifiersFrom(found);
  // The whole-hour fee model measures one day (0-23); a stay across midnight cannot be priced
  // by it, so the operator is told rather than silently charged for the wrong hours.
  const crossedMidnight = campusDateAt(Date.parse(session.entryAt)) !== campusDateAt(serverNow());

  const calculate = async () => {
    setError(null);
    setQuoting(true);
    try {
      setQuote(
        await parkingApi.quote({ sessionNumber: session.sessionNumber, exitHour, ...identifiers }),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setQuoting(false);
    }
  };

  const pay = async (outcome: 'SUCCESS' | 'FAILURE') => {
    if (!quote) return;
    setError(null);
    const chosen: PaymentMethod = quote.fee.totalPaise === 0 ? 'NO_CHARGE' : method;
    setStep({ name: 'paying', stage: 'creating', payment: null });
    try {
      const { payment } = await parkingApi.createPayment({
        sessionNumber: session.sessionNumber,
        exitHour: quote.exitHour,
        method: chosen,
        ...identifiers,
      });
      setStep({ name: 'paying', stage: 'processing', payment });
      await pause(STAGE_MS);
      setStep({ name: 'paying', stage: 'verifying', payment });
      const [result] = await Promise.all([
        parkingApi.processPayment(payment.id, session.sessionNumber, outcome),
        pause(STAGE_MS),
      ]);
      setStep({ name: 'done', outcome: result });
    } catch (caught) {
      setError(caught);
      setStep({ name: 'review' });
    }
  };

  if (step.name === 'paying') return <PaymentProgress stage={step.stage} payment={step.payment} />;
  if (step.name === 'done') {
    return (
      <PaymentOutcome
        outcome={step.outcome}
        slotCode={session.slotCode}
        onRetry={() => setStep({ name: 'review' })}
        onReset={onReset}
      />
    );
  }

  const chargeable = quote !== null && quote.fee.totalPaise > 0;

  return (
    <div
      className={cn(
        'grid gap-6',
        quote ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]' : 'max-w-3xl',
      )}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t('parking.exit.vehicleTitle')}</CardTitle>
          <CardDescription>{session.block.name}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {verifiedBy && (
            <Alert variant="success">
              <CircleCheck aria-hidden />
              <AlertTitle>
                {verifiedBy === 'ENTRY_QR'
                  ? t('parking.exit.verifiedQr')
                  : t('parking.exit.verifiedCode')}
              </AlertTitle>
              <AlertDescription>{t('parking.exit.verifiedNote')}</AlertDescription>
            </Alert>
          )}
          {crossedMidnight && (
            <Alert variant="warning">
              <CircleAlert aria-hidden />
              <AlertTitle>{t('parking.exit.overnightTitle')}</AlertTitle>
              <AlertDescription>{t('parking.exit.overnightBody')}</AlertDescription>
            </Alert>
          )}
          <SessionDetails session={session} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-2">
              <Label htmlFor="exit-hour">{t('parking.common.exitHour')}</Label>
              <NativeSelect
                id="exit-hour"
                className="w-40"
                value={String(exitHour)}
                onChange={(event) => {
                  setExitHour(Number(event.target.value));
                  setQuote(null);
                }}
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour} disabled={hour < session.entryHour}>
                    {formatHour(hour)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button onClick={() => void calculate()} disabled={quoting}>
              {quoting && <LoaderCircle className="animate-spin" aria-hidden />}
              {t('parking.exit.calculate')}
            </Button>
            <Button variant="ghost" onClick={onReset}>
              {t('parking.exit.changeVehicle')}
            </Button>
          </div>
          {error !== null && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{errorMessage(t, error)}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {quote && (
        <Card>
          <CardHeader>
            <CardTitle>{t('parking.exit.feePreviewTitle')}</CardTitle>
            <CardDescription>
              {formatHour(session.entryHour)} → {formatHour(quote.exitHour)} ·{' '}
              {t('parking.common.hours', { count: quote.durationHours })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FeeBreakdownView fee={quote.fee} />

            <Alert variant="info">
              <FlaskConical aria-hidden />
              <AlertDescription>{t('parking.payment.demoNotice')}</AlertDescription>
            </Alert>

            {chargeable ? (
              <div className="grid gap-2">
                <Label id="payment-method-label">{t('parking.payment.methodLabel')}</Label>
                <ChoiceGroup
                  name="payment-method"
                  value={method}
                  onChange={setMethod}
                  aria-labelledby="payment-method-label"
                  options={CHARGEABLE_PAYMENT_METHODS.map((value) => ({
                    value,
                    label: t(`parking.paymentMethods.${value}`),
                    icon: METHOD_ICONS[value],
                  }))}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('parking.payment.noChargeNotice')}</p>
            )}

            <div className="flex flex-col gap-2">
              <Button size="lg" onClick={() => void pay('SUCCESS')}>
                {chargeable
                  ? t('parking.payment.pay', { amount: format.paise(quote.fee.totalPaise) })
                  : t('parking.payment.completeNoCharge')}
              </Button>
              {chargeable && (
                <Button variant="link" size="sm" onClick={() => void pay('FAILURE')}>
                  {t('parking.payment.simulateDecline')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PaymentProgress({ stage, payment }: { stage: PaymentStage; payment: PaymentView | null }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const stages: PaymentStage[] = ['creating', 'processing', 'verifying'];
  const current = stages.indexOf(stage);

  return (
    <Card className="mx-auto w-full max-w-lg" aria-live="polite">
      <CardHeader className="text-center">
        <CardTitle>{t('parking.payment.inProgressTitle')}</CardTitle>
        {payment && (
          <CardDescription>
            {format.paise(payment.amountPaise)} · {t(`parking.paymentMethods.${payment.method}`)} ·{' '}
            <StatusBadge tone="warning">{t('parking.payment.testBadge')}</StatusBadge>
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {stages.map((name, index) => (
            <li key={name} className="flex items-center gap-3 text-sm">
              {index < current ? (
                <CircleCheck className="size-5 text-success" aria-hidden />
              ) : index === current ? (
                <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden />
              ) : (
                <span className="size-5 rounded-full border-2" aria-hidden />
              )}
              <span className={index > current ? 'text-muted-foreground' : undefined}>
                {t(`parking.payment.stages.${name}`)}
              </span>
            </li>
          ))}
        </ol>
        {payment && (
          <p className="mt-4 text-center font-mono text-xs text-muted-foreground">
            {payment.transactionId}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PaymentOutcome({
  outcome,
  slotCode,
  onRetry,
  onReset,
}: {
  outcome: ProcessPaymentResponse;
  slotCode: string;
  onRetry: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormatters();
  const { user } = useCurrentUser();
  const paths = areaPaths(user.role);
  const { payment, receipt } = outcome;

  if (payment.status !== 'PAID' || !receipt) {
    return (
      <Card className="mx-auto w-full max-w-lg border-destructive/40">
        <CardHeader className="text-center">
          <CircleX className="mx-auto size-10 text-destructive" aria-hidden />
          <CardTitle className="text-destructive">{t('parking.payment.failedTitle')}</CardTitle>
          <CardDescription>{t('parking.payment.failedDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <DescriptionList>
            <DescriptionItem label={t('parking.payment.transactionId')}>
              <span className="font-mono">{payment.transactionId}</span>
            </DescriptionItem>
            <DescriptionItem label={t('parking.common.status')}>
              <StatusBadge tone="danger">
                {t(`parking.paymentStatus.${payment.status}`)}
              </StatusBadge>
            </DescriptionItem>
          </DescriptionList>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={onRetry}>{t('common.retry')}</Button>
            <Button variant="outline" onClick={onReset}>
              {t('parking.exit.changeVehicle')}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const free = payment.amountPaise === 0;
  return (
    <Card className="mx-auto w-full max-w-lg border-success/40">
      <CardHeader className="text-center">
        <CircleCheck className="mx-auto size-10 text-success" aria-hidden />
        <CardTitle className="text-success">
          {free ? t('parking.payment.noChargeSuccessTitle') : t('parking.payment.successTitle')}
        </CardTitle>
        <CardDescription>
          {t('parking.payment.successDescription', { slot: slotCode })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <DescriptionList>
          <DescriptionItem label={t('parking.fee.total')}>
            <span className="text-lg font-bold">{format.paise(payment.amountPaise)}</span>
          </DescriptionItem>
          <DescriptionItem label={t('parking.payment.transactionId')}>
            <span className="font-mono">{payment.transactionId}</span>
          </DescriptionItem>
          <DescriptionItem label={t('parking.receipt.receiptNumber')}>
            <span className="font-mono">{receipt.receiptNumber}</span>
          </DescriptionItem>
          <DescriptionItem label={t('parking.payment.statusLabel')}>
            <StatusBadge tone="success">{t(`parking.paymentStatus.${payment.status}`)}</StatusBadge>{' '}
            <StatusBadge tone="warning">{t('parking.payment.testBadge')}</StatusBadge>
          </DescriptionItem>
        </DescriptionList>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to={paths.receipt(receipt.receiptNumber)}>
              <ReceiptText aria-hidden />
              {t('parking.common.viewReceipt')}
            </Link>
          </Button>
          <Button variant="outline" onClick={onReset}>
            {t('parking.exit.nextVehicle')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CompletedSessionNotice({
  receiptNumber,
  onReset,
}: {
  receiptNumber: string | null;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  return (
    <Alert variant="warning" className="max-w-3xl">
      <CircleAlert aria-hidden />
      <AlertTitle>{t('errors.SESSION_NOT_ACTIVE')}</AlertTitle>
      <AlertDescription>
        <div className="mt-2 flex flex-wrap gap-2">
          {receiptNumber && (
            <Button asChild size="sm">
              <Link to={areaPaths(user.role).receipt(receiptNumber)}>
                {t('parking.common.viewReceipt')}
              </Link>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onReset}>
            {t('parking.exit.changeVehicle')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
