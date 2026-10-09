import type {
  CashHandoverRequest,
  ResolveDiscrepancyRequest,
  ShiftTransactionView,
  ShiftView,
} from '@cpvts/shared';
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  CreditCard,
  FileText,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminShiftsApi } from '@/features/shifts/shifts-api';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';

export function AdminCashPage() {
  const { t } = useTranslation();
  const format = useFormatters();

  const summaryQuery = useApiQuery(
    (signal) => adminShiftsApi.cashSummary(undefined, signal),
    { refreshIntervalMs: 15_000 },
  );

  // Handover dialog state
  const [handoverShift, setHandoverShift] = useState<ShiftView | null>(null);
  const [actualCashRupees, setActualCashRupees] = useState<string>('');
  const [handoverNote, setHandoverNote] = useState<string>('');

  // Discrepancy resolve dialog state
  const [resolveShift, setResolveShift] = useState<ShiftView | null>(null);
  const [resolutionNote, setResolutionNote] = useState<string>('');

  // Shift transactions viewer dialog state
  const [transactionsShift, setTransactionsShift] = useState<ShiftView | null>(null);
  const [transactions, setTransactions] = useState<ShiftTransactionView[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const summary = summaryQuery.data;

  const openHandover = (shift: ShiftView) => {
    setHandoverShift(shift);
    setActualCashRupees(String(shift.cash.expectedCashPaise / 100));
    setHandoverNote('');
    setModalError(null);
  };

  const handleRecordHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handoverShift) return;
    setSubmitting(true);
    setModalError(null);

    const actualPaise = Math.round(Number(actualCashRupees) * 100);
    const diffPaise = actualPaise - handoverShift.cash.expectedCashPaise;

    if (diffPaise !== 0 && !handoverNote.trim()) {
      setModalError('A reason note is required when the handed over cash differs from the expected amount.');
      setSubmitting(false);
      return;
    }

    try {
      const payload: CashHandoverRequest = {
        actualCashPaise: actualPaise,
        note: handoverNote.trim() || undefined,
      };
      await adminShiftsApi.recordHandover(handoverShift.id, payload);
      setHandoverShift(null);
      summaryQuery.reload();
    } catch (err) {
      setModalError(errorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  const openResolve = (shift: ShiftView) => {
    setResolveShift(shift);
    setResolutionNote('');
    setModalError(null);
  };

  const handleResolveDiscrepancy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolveShift || !resolutionNote.trim()) return;
    setSubmitting(true);
    setModalError(null);
    try {
      const payload: ResolveDiscrepancyRequest = {
        note: resolutionNote.trim(),
      };
      await adminShiftsApi.resolveDiscrepancy(resolveShift.id, payload);
      setResolveShift(null);
      summaryQuery.reload();
    } catch (err) {
      setModalError(errorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  const openTransactions = async (shift: ShiftView) => {
    setTransactionsShift(shift);
    setLoadingTransactions(true);
    try {
      const list = await adminShiftsApi.transactions(shift.id);
      setTransactions(list);
    } catch (err) {
      alert(errorMessage(t, err));
      setTransactionsShift(null);
    } finally {
      setLoadingTransactions(false);
    }
  };

  const calculatedDifference = handoverShift
    ? Math.round(Number(actualCashRupees) * 100) - handoverShift.cash.expectedCashPaise
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash Collection & Reconciliation"
        description="Shift-level cash reconciliation, physical handovers, and discrepancy tracking"
        actions={
          <Button variant="outline" size="sm" onClick={() => summaryQuery.reload()} className="gap-1.5">
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      {summaryQuery.status === 'loading' && <LoadingState />}
      {summaryQuery.status === 'error' && (
        <ErrorState
          description={errorMessage(t, summaryQuery.error)}
          onRetry={summaryQuery.refetch}
        />
      )}

      {summary && (
        <div className="space-y-6">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 bg-muted/20 border-border">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
                <Coins className="size-4 text-amber-500" /> Expected Cash
              </span>
              <p className="text-xl font-bold font-mono mt-1 text-foreground">
                {format.paise(summary.totals.expectedCashPaise)}
              </p>
              <span className="text-[11px] text-muted-foreground">Across duty shifts</span>
            </Card>

            <Card className="p-4 bg-muted/20 border-border">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
                <Wallet className="size-4 text-emerald-500" /> Cash Received
              </span>
              <p className="text-xl font-bold font-mono mt-1 text-emerald-600 dark:text-emerald-400">
                {format.paise(summary.totals.receivedCashPaise)}
              </p>
              <span className="text-[11px] text-muted-foreground">Admin confirmed handovers</span>
            </Card>

            <Card className="p-4 bg-muted/20 border-border">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
                <CreditCard className="size-4 text-blue-500" /> Digital Collections
              </span>
              <p className="text-xl font-bold font-mono mt-1 text-blue-600 dark:text-blue-400">
                {format.paise(summary.totals.digitalPaise)}
              </p>
              <span className="text-[11px] text-muted-foreground">Simulated UPI & Cards</span>
            </Card>

            <Card className="p-4 bg-muted/20 border-border">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-4 text-amber-600" /> Open Discrepancy
              </span>
              <p
                className={`text-xl font-bold font-mono mt-1 ${
                  summary.totals.unresolvedDifferencePaise !== 0 ? 'text-destructive' : 'text-foreground'
                }`}
              >
                {format.paise(summary.totals.unresolvedDifferencePaise)}
              </p>
              <span className="text-[11px] text-muted-foreground">
                {summary.openDiscrepancies.length} unreviewed difference(s)
              </span>
            </Card>
          </div>

          <Tabs defaultValue="awaiting" className="space-y-4">
            <TabsList>
              <TabsTrigger value="awaiting" className="gap-1.5">
                <Coins className="size-4" />
                Awaiting Handover ({summary.awaitingHandover.length})
              </TabsTrigger>
              <TabsTrigger value="discrepancies" className="gap-1.5">
                <AlertTriangle className="size-4" />
                Discrepancies ({summary.openDiscrepancies.length})
              </TabsTrigger>
            </TabsList>

            {/* Tab: Awaiting Handover */}
            <TabsContent value="awaiting">
              <Card>
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-base font-bold">Checked-Out Shifts Awaiting Cash Handover</CardTitle>
                  <CardDescription className="text-xs">
                    Shifts completed by Security Staff where physical cash has not yet been accepted by an administrator
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  {summary.awaitingHandover.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground border rounded-lg border-dashed">
                      All completed shifts have reconciled their cash handovers.
                    </div>
                  ) : (
                    <div className="divide-y rounded-lg border">
                      {summary.awaitingHandover.map((shift: ShiftView) => (
                        <div
                          key={shift.id}
                          className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-foreground">{shift.staff.fullName}</span>
                              <Badge variant="secondary" className="text-[10px]">
                                {shift.gate ?? 'Gate'}
                              </Badge>
                              <Badge variant="outline" className="font-mono text-[10px]">
                                {shift.date}
                              </Badge>
                            </div>
                            <p className="text-muted-foreground">
                              {shift.name} · Checked out {shift.checkedOutAt ? format.time(shift.checkedOutAt) : 'N/A'}
                            </p>
                            <div className="flex gap-3 text-[11px] font-mono">
                              <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                Expected Cash: {format.paise(shift.cash.expectedCashPaise)}
                              </span>
                              <span className="text-muted-foreground">
                                ({shift.cash.cashTransactions} cash payments)
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openTransactions(shift)}
                              className="text-xs h-8"
                            >
                              <FileText className="size-3.5 mr-1" />
                              Txns
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => openHandover(shift)}
                              className="text-xs h-8 gap-1"
                            >
                              <CheckCircle2 className="size-3.5" />
                              Record Handover
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Discrepancies */}
            <TabsContent value="discrepancies">
              <Card>
                <CardHeader className="pb-3 border-b">
                  <CardTitle className="text-base font-bold">Unresolved Cash Discrepancies</CardTitle>
                  <CardDescription className="text-xs">
                    Shifts where actual cash handed over did not match the expected system collection
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  {summary.openDiscrepancies.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground border rounded-lg border-dashed">
                      No open discrepancies. All cash handovers are balanced or reviewed.
                    </div>
                  ) : (
                    <div className="divide-y rounded-lg border">
                      {summary.openDiscrepancies.map((shift: ShiftView) => {
                        const ho = shift.handover;
                        return (
                          <div
                            key={shift.id}
                            className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-foreground">{shift.staff.fullName}</span>
                                <Badge variant="destructive" className="text-[10px]">
                                  {ho && ho.differencePaise > 0
                                    ? `+${format.paise(ho.differencePaise)} Over`
                                    : ho
                                      ? `${format.paise(ho.differencePaise)} Short`
                                      : 'Mismatch'}
                                </Badge>
                              </div>
                              <p className="text-muted-foreground">
                                Shift {shift.name} ({shift.date}) · Expected: {format.paise(ho?.expectedCashPaise ?? 0)} · Received: {format.paise(ho?.actualCashPaise ?? 0)}
                              </p>
                              {ho?.note && (
                                <p className="text-[11px] italic text-muted-foreground">
                                  Guard reason: &quot;{ho.note}&quot;
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-2 self-end sm:self-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openTransactions(shift)}
                                className="text-xs h-8"
                              >
                                Txns
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openResolve(shift)}
                                className="text-xs h-8"
                              >
                                Review & Resolve
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Dialog: Record Handover */}
      <Dialog open={!!handoverShift} onOpenChange={(open) => !open && setHandoverShift(null)}>
        <DialogContent className="sm:max-w-md">
          {handoverShift && (
            <form onSubmit={handleRecordHandover} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Record Cash Handover</DialogTitle>
                <DialogDescription className="text-xs">
                  Count the physical cash received from {handoverShift.staff.fullName} for shift &quot;{handoverShift.name}&quot;.
                </DialogDescription>
              </DialogHeader>

              {modalError && (
                <Alert variant="destructive">
                  <ShieldAlert className="size-4" />
                  <AlertDescription className="text-xs">{modalError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-lg border bg-muted/20 flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">Expected Cash</span>
                  <span className="font-mono font-bold text-base text-foreground">
                    {format.paise(handoverShift.cash.expectedCashPaise)}
                  </span>
                </div>

                <div>
                  <Label htmlFor="actual-cash" className="text-xs">Actual Cash Received (₹)</Label>
                  <Input
                    id="actual-cash"
                    type="number"
                    step="1"
                    min="0"
                    value={actualCashRupees}
                    onChange={(e) => setActualCashRupees(e.target.value)}
                    required
                    className="mt-1 font-mono text-base font-bold"
                  />
                </div>

                <div className="p-3 rounded-lg border flex justify-between items-center">
                  <span className="text-muted-foreground">Difference</span>
                  <span
                    className={`font-mono font-bold ${
                      calculatedDifference === 0
                        ? 'text-emerald-600'
                        : calculatedDifference > 0
                          ? 'text-blue-600'
                          : 'text-destructive'
                    }`}
                  >
                    {calculatedDifference === 0
                      ? 'Balanced (₹0)'
                      : calculatedDifference > 0
                        ? `+${format.paise(calculatedDifference)} (Surplus)`
                        : `${format.paise(calculatedDifference)} (Shortage)`}
                  </span>
                </div>

                {calculatedDifference !== 0 && (
                  <div>
                    <Label htmlFor="handover-note" className="text-xs text-destructive">
                      Reason for Discrepancy (Required)
                    </Label>
                    <Input
                      id="handover-note"
                      value={handoverNote}
                      onChange={(e) => setHandoverNote(e.target.value)}
                      placeholder="e.g. Counter change shortage or coin count difference"
                      required
                      className="mt-1 text-xs border-destructive/50"
                    />
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setHandoverShift(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting && <LoaderCircle className="size-3.5 animate-spin mr-1" />}
                  Confirm Handover
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Resolve Discrepancy */}
      <Dialog open={!!resolveShift} onOpenChange={(open) => !open && setResolveShift(null)}>
        <DialogContent className="sm:max-w-md">
          {resolveShift && (
            <form onSubmit={handleResolveDiscrepancy} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Review Discrepancy</DialogTitle>
                <DialogDescription className="text-xs">
                  Review and close the cash difference recorded for {resolveShift.staff.fullName}.
                </DialogDescription>
              </DialogHeader>

              {modalError && (
                <Alert variant="destructive">
                  <ShieldAlert className="size-4" />
                  <AlertDescription className="text-xs">{modalError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Recorded Difference:</span>
                    <span className="font-mono font-bold text-destructive">
                      {format.paise(resolveShift.handover?.differencePaise ?? 0)}
                    </span>
                  </div>
                  {resolveShift.handover?.note && (
                    <div className="text-[11px] text-muted-foreground">
                      Guard note: &quot;{resolveShift.handover.note}&quot;
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="res-note" className="text-xs">Administrative Resolution Note</Label>
                  <Input
                    id="res-note"
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    placeholder="e.g. Reviewed with security supervisor and approved"
                    required
                    className="mt-1 text-xs"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setResolveShift(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={submitting || !resolutionNote.trim()}>
                  {submitting && <LoaderCircle className="size-3.5 animate-spin mr-1" />}
                  Approve & Close Shift
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Shift Transactions */}
      <Dialog open={!!transactionsShift} onOpenChange={(open) => !open && setTransactionsShift(null)}>
        <DialogContent className="sm:max-w-xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Shift Transactions</DialogTitle>
            <DialogDescription className="text-xs">
              All payment transactions attributed to shift &quot;{transactionsShift?.name}&quot; ({transactionsShift?.staff.fullName})
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
            {loadingTransactions && <LoadingState />}
            {!loadingTransactions && transactions.length === 0 && (
              <div className="py-6 text-center text-muted-foreground">No payments recorded during this shift.</div>
            )}
            {!loadingTransactions &&
              transactions.map((txn) => (
                <div key={txn.transactionId} className="p-3 rounded-lg border flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm">{txn.vehicleNumber}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {txn.method}
                      </Badge>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      Session #{txn.sessionNumber} · {format.dateTime(txn.paidAt)}
                    </span>
                  </div>
                  <span className="font-mono font-bold text-sm text-foreground">
                    {format.paise(txn.amountPaise)}
                  </span>
                </div>
              ))}
          </div>

          <DialogFooter>
            <Button size="sm" onClick={() => setTransactionsShift(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
