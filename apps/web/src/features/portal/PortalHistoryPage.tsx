import type { HistoryItem, VehicleType } from '@cpvts/shared';
import {
  Filter,
  Receipt,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SessionTimeline } from '@/features/parking/SessionTimeline';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { formatHour } from '@/lib/format';

import { portalApi } from './portal-api';

export function PortalHistoryPage() {
  const { t } = useTranslation();
  const format = useFormatters();

  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [activeFilters, setActiveFilters] = useState<{
    vehicleNumber?: string;
    vehicleType?: VehicleType;
    from?: string;
    to?: string;
    page: number;
  }>({ page: 1 });

  const fetchHistory = useCallback(
    () =>
      portalApi.history({
        page: activeFilters.page,
        pageSize: 15,
        vehicleNumber: activeFilters.vehicleNumber,
        vehicleType: activeFilters.vehicleType,
        from: activeFilters.from,
        to: activeFilters.to,
      }),
    [activeFilters],
  );

  const query = useApiQuery(fetchHistory);

  const [timelineSession, setTimelineSession] = useState<HistoryItem | null>(null);

  const handleApplyFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveFilters({
      page: 1,
      vehicleNumber: vehicleNumber.trim() || undefined,
      vehicleType: vehicleType || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  };

  const handleResetFilter = () => {
    setVehicleNumber('');
    setVehicleType('');
    setFrom('');
    setTo('');
    setActiveFilters({ page: 1 });
  };

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.ceil(total / 15);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parking History"
        description="Comprehensive audit of all past and active sessions for your vehicles"
        actions={
          <Button variant="outline" size="sm" onClick={query.reload}>
            <RefreshCw className="size-4" aria-hidden />
            Refresh
          </Button>
        }
      />

      {/* Filter Bar */}
      <Card className="p-4 shadow-xs">
        <form onSubmit={handleApplyFilter} className="flex flex-wrap items-end gap-3 text-xs">
          <div className="space-y-1">
            <label className="font-semibold text-muted-foreground">Vehicle Number</label>
            <Input
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
              placeholder="e.g. KA22"
              className="h-8 w-36"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-muted-foreground">Type</label>
            <select
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value as VehicleType | '')}
              className="flex h-8 rounded-md border border-input bg-background px-2 py-1 text-xs shadow-xs focus-visible:outline-none"
            >
              <option value="">All Types</option>
              <option value="TWO_WHEELER">Two-wheeler</option>
              <option value="FOUR_WHEELER">Four-wheeler</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-muted-foreground">From Date</label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-36"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-muted-foreground">To Date</label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-36"
            />
          </div>

          <div className="flex gap-2 ml-auto">
            <Button type="button" variant="ghost" size="sm" onClick={handleResetFilter} className="h-8 text-xs">
              Reset
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs gap-1.5">
              <Filter className="size-3.5" />
              Apply
            </Button>
          </div>
        </form>
      </Card>

      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}

      {query.status === 'success' && (
        <Card className="shadow-xs overflow-hidden">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base font-semibold">
              Sessions ({total})
            </CardTitle>
            <CardDescription className="text-xs">
              Click any session to inspect its complete step-by-step timeline.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            {items.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                No parking sessions found matching your filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Block & Slot</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Exit</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Fee</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const isCompleted = item.status === 'COMPLETED';

                      return (
                        <TableRow
                          key={item.sessionNumber}
                          className="cursor-pointer hover:bg-muted/40 transition-colors"
                          onClick={() => setTimelineSession(item)}
                        >
                          <TableCell>
                            <span className="font-mono font-bold block">{item.vehicleNumber}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {t(`vehicleTypes.${item.vehicleType}`)}
                            </span>
                          </TableCell>

                          <TableCell>
                            <span className="font-semibold block">{item.blockName}</span>
                            <span className="font-mono text-primary font-bold text-xs">
                              Slot {item.slotCode}
                            </span>
                          </TableCell>

                          <TableCell>
                            <span className="block">{format.date(item.entryAt)}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {formatHour(item.entryHour)}
                            </span>
                          </TableCell>

                          <TableCell>
                            {item.exitAt ? (
                              <>
                                <span className="block">{format.date(item.exitAt)}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {item.exitHour !== null ? formatHour(item.exitHour) : '—'}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          <TableCell className="font-medium">
                            {item.durationHours !== null ? `${item.durationHours} hr(s)` : 'Active'}
                          </TableCell>

                          <TableCell className="font-mono font-bold">
                            {item.feePaise !== null ? format.paise(item.feePaise) : '—'}
                          </TableCell>

                          <TableCell>
                            <Badge
                              variant={isCompleted ? 'secondary' : 'default'}
                              className="text-[10px]"
                            >
                              {isCompleted ? 'Completed' : 'Parked'}
                            </Badge>
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setTimelineSession(item)}
                              >
                                Timeline
                              </Button>

                              {item.receiptNumber && (
                                <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1">
                                  <Link to={`/portal/receipts/${encodeURIComponent(item.receiptNumber)}`}>
                                    <Receipt className="size-3" />
                                    Receipt
                                  </Link>
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-4 border-t flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Page {activeFilters.page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={activeFilters.page <= 1}
                    onClick={() =>
                      setActiveFilters((prev) => ({ ...prev, page: prev.page - 1 }))
                    }
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={activeFilters.page >= totalPages}
                    onClick={() =>
                      setActiveFilters((prev) => ({ ...prev, page: prev.page + 1 }))
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Session Timeline Dialog */}
      <Dialog
        open={timelineSession !== null}
        onOpenChange={(open) => !open && setTimelineSession(null)}
      >
        <DialogContent className="max-w-2xl" closeLabel={t('common.close')}>
          {timelineSession && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Session Timeline · #{timelineSession.sessionNumber}
                </DialogTitle>
                <DialogDescription>
                  Audit replay for {timelineSession.vehicleNumber} in {timelineSession.blockName} (
                  {timelineSession.slotCode})
                </DialogDescription>
              </DialogHeader>

              <div className="py-2">
                <SessionTimeline sessionNumber={timelineSession.sessionNumber} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
