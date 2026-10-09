import type { NotificationKind, NotificationView } from '@cpvts/shared';
import {
  AlertTriangle,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Coins,
  Info,
  ParkingCircle,
  Receipt,
  XCircle,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { notificationsApi } from '@/features/notifications/notifications-api';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { cn } from '@/lib/utils';

export function NotificationBell() {
  const { t } = useTranslation();
  const format = useFormatters();
  const [open, setOpen] = useState(false);
  const [markedReadIds, setMarkedReadIds] = useState<string[]>([]);
  const [allMarkedRead, setAllMarkedRead] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetcher = useCallback(
    () => notificationsApi.list({ limit: 30 }),
    [],
  );
  const query = useApiQuery(fetcher, { refreshIntervalMs: 20_000 });

  const notifications = useMemo(() => {
    const items = query.data?.items ?? [];
    if (allMarkedRead) {
      return items.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }));
    }
    if (markedReadIds.length === 0) return items;
    return items.map((n) =>
      markedReadIds.includes(n.id) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n,
    );
  }, [query.data?.items, allMarkedRead, markedReadIds]);

  const unreadCount = useMemo(() => {
    if (allMarkedRead) return 0;
    const baseCount = query.data?.unreadCount ?? 0;
    return Math.max(0, baseCount - markedReadIds.length);
  }, [query.data?.unreadCount, allMarkedRead, markedReadIds]);

  const handleOpen = () => {
    setOpen(true);
    query.reload();
  };

  const markAsRead = async (id: string) => {
    try {
      await notificationsApi.markRead(id);
      setMarkedReadIds((prev) => [...prev, id]);
    } catch {
      // Ignore
    }
  };

  const markAllRead = async () => {
    setActionLoading(true);
    try {
      await notificationsApi.markAllRead();
      setAllMarkedRead(true);
      query.reload();
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label="Notifications"
        onClick={handleOpen}
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md sm:max-w-lg" closeLabel={t('common.close')}>
          <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b">
            <div>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                <Bell className="size-4 text-primary" />
                Notifications
              </DialogTitle>
              <DialogDescription className="text-xs">
                {unreadCount > 0
                  ? `${unreadCount} unread update(s)`
                  : 'You are all caught up!'}
              </DialogDescription>
            </div>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={markAllRead}
                disabled={actionLoading}
                className="text-xs h-8 gap-1 text-primary"
              >
                <Check className="size-3.5" />
                Mark all as read
              </Button>
            )}
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto space-y-2 py-2 pr-1">
            {notifications.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <Bell className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                No notifications yet.
              </div>
            ) : (
              notifications.map((item) => {
                const isUnread = !item.readAt;
                return (
                  <div
                    key={item.id}
                    onClick={() => isUnread && markAsRead(item.id)}
                    className={cn(
                      'group flex items-start gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer',
                      isUnread
                        ? 'bg-primary/5 border-primary/20 hover:bg-primary/10'
                        : 'bg-card hover:bg-muted/40 border-border/60 opacity-85',
                    )}
                  >
                    <NotificationIcon kind={item.kind} />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold leading-none">
                          {getNotificationTitle(item)}
                        </span>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {format.time(item.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {getNotificationBody(item, format)}
                      </p>
                    </div>
                    {isUnread && (
                      <span className="size-2 rounded-full bg-primary shrink-0 mt-1" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NotificationIcon({ kind }: { kind: NotificationKind }) {
  switch (kind) {
    case 'VERIFICATION_APPROVED':
      return (
        <div className="flex size-7 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 shrink-0">
          <CheckCircle2 className="size-4" />
        </div>
      );
    case 'VERIFICATION_REJECTED':
      return (
        <div className="flex size-7 items-center justify-center rounded-full bg-destructive/10 text-destructive shrink-0">
          <XCircle className="size-4" />
        </div>
      );
    case 'PARKING_STARTED':
      return (
        <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
          <ParkingCircle className="size-4" />
        </div>
      );
    case 'RECEIPT_GENERATED':
      return (
        <div className="flex size-7 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 shrink-0">
          <Receipt className="size-4" />
        </div>
      );
    case 'SHIFT_ASSIGNED':
      return (
        <div className="flex size-7 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 shrink-0">
          <Calendar className="size-4" />
        </div>
      );
    case 'SHIFT_CASH_DUE':
      return (
        <div className="flex size-7 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 shrink-0">
          <Coins className="size-4" />
        </div>
      );
    case 'CASH_DISCREPANCY':
      return (
        <div className="flex size-7 items-center justify-center rounded-full bg-destructive/10 text-destructive shrink-0">
          <AlertTriangle className="size-4" />
        </div>
      );
    case 'SHIFT_MISSED':
      return (
        <div className="flex size-7 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 shrink-0">
          <Clock className="size-4" />
        </div>
      );
    case 'PARKING_NOTICE':
    default:
      return (
        <div className="flex size-7 items-center justify-center rounded-full bg-sky-500/10 text-sky-600 shrink-0">
          <Info className="size-4" />
        </div>
      );
  }
}

function getNotificationTitle(item: NotificationView): string {
  switch (item.kind) {
    case 'VERIFICATION_APPROVED':
      return 'Identity Verification Approved';
    case 'VERIFICATION_REJECTED':
      return 'Verification Requires Resubmission';
    case 'PARKING_STARTED':
      return 'Parking Session Started';
    case 'RECEIPT_GENERATED':
      return 'Parking Receipt Available';
    case 'SHIFT_ASSIGNED':
      return 'New Security Shift Assigned';
    case 'SHIFT_CASH_DUE':
      return 'Shift Cash Handover Due';
    case 'CASH_DISCREPANCY':
      return 'Cash Handover Discrepancy';
    case 'SHIFT_MISSED':
      return 'Missed Shift Alert';
    case 'PARKING_NOTICE':
      return item.params.title || 'Campus Parking Notice';
    default:
      return 'System Notification';
  }
}

function getNotificationBody(
  item: NotificationView,
  format: ReturnType<typeof useFormatters>,
): string {
  switch (item.kind) {
    case 'VERIFICATION_APPROVED':
      return 'Your institutional identity document has been verified. You can now use all parking features!';
    case 'VERIFICATION_REJECTED':
      return item.params.note
        ? `Verification rejected: ${item.params.note}. Please resubmit an updated document from your profile.`
        : 'Your document could not be verified. Please resubmit from your profile.';
    case 'PARKING_STARTED':
      return `Vehicle ${item.params.vehicleNumber ?? ''} parked in slot ${item.params.slotCode ?? ''} (${item.params.blockName ?? ''}). Session #${item.params.sessionNumber ?? ''}.`;
    case 'RECEIPT_GENERATED':
      return `Receipt #${item.params.receiptNumber ?? ''} issued for ${item.params.amountPaise !== undefined ? format.paise(item.params.amountPaise) : 'session'}.`;
    case 'SHIFT_ASSIGNED':
      return `Shift assigned: ${item.params.shiftName ?? 'Duty'} on ${item.params.date ?? 'today'}. Gate: ${item.params.gate ?? 'All Gates'}.`;
    case 'SHIFT_CASH_DUE':
      return `Security shift ${item.params.shiftName ?? ''} has checked out. Expected cash: ${item.params.amountPaise !== undefined ? format.paise(item.params.amountPaise) : 'due'}.`;
    case 'CASH_DISCREPANCY':
      return `A cash discrepancy was reported for shift ${item.params.shiftName ?? ''}. Difference: ${item.params.differencePaise !== undefined ? format.paise(item.params.differencePaise) : 'unbalanced'}.`;
    case 'SHIFT_MISSED':
      return `No check-in recorded for shift ${item.params.shiftName ?? ''} on ${item.params.date ?? 'today'}.`;
    case 'PARKING_NOTICE':
      return item.params.message || 'Important notice from campus parking administration.';
    default:
      return '';
  }
}
