import {
  Eye,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';

import { portalApi } from './portal-api';

export function PortalReceiptsPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const [page, setPage] = useState(1);

  const fetchReceipts = useCallback(
    () => portalApi.receipts({ page, pageSize: 15 }),
    [page],
  );

  const query = useApiQuery(fetchReceipts);

  const receipts = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.ceil(total / 15);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parking Receipts"
        description="Official payment receipts issued for your completed parking stays"
        actions={
          <Button variant="outline" size="sm" onClick={query.reload}>
            <RefreshCw className="size-4" aria-hidden />
            Refresh
          </Button>
        }
      />

      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}

      {query.status === 'success' && (
        <Card className="shadow-xs overflow-hidden">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base font-semibold">
              Receipt History ({total})
            </CardTitle>
            <CardDescription className="text-xs">
              Every receipt includes full duration breakdown, transaction ID, and verification QR.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            {receipts.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                No receipts found for your account.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Receipt #</TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Issued At</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receipts.map((rcpt) => (
                      <TableRow key={rcpt.receiptNumber} className="hover:bg-muted/40">
                        <TableCell className="font-mono font-bold text-xs">
                          <Link
                            to={`/portal/receipts/${encodeURIComponent(rcpt.receiptNumber)}`}
                            className="text-primary hover:underline"
                          >
                            {rcpt.receiptNumber}
                          </Link>
                        </TableCell>

                        <TableCell>
                          <span className="font-mono font-bold block">{rcpt.vehicleNumber}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {t(`vehicleTypes.${rcpt.vehicleType}`)}
                          </span>
                        </TableCell>

                        <TableCell>
                          <span className="font-semibold block">{rcpt.block.name}</span>
                          <span className="font-mono text-primary font-bold text-xs">
                            Slot {rcpt.slotCode}
                          </span>
                        </TableCell>

                        <TableCell className="text-xs">{format.dateTime(rcpt.issuedAt)}</TableCell>

                        <TableCell className="text-xs font-medium">
                          {rcpt.durationHours} hr(s)
                        </TableCell>

                        <TableCell className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                          {format.paise(rcpt.totalPaise)}
                        </TableCell>

                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {rcpt.payment.method}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-right">
                          <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1">
                            <Link to={`/portal/receipts/${encodeURIComponent(rcpt.receiptNumber)}`}>
                              <Eye className="size-3" />
                              View
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="p-4 border-t flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
