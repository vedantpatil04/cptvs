import type {
  HistoryItem,
  UserListItem,
  UserListKind,
  VerificationStatus,
} from '@cpvts/shared';
import {
  CheckCircle2,
  Download,
  Edit2,
  Eye,
  FileText,
  LoaderCircle,
  Power,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { downloadBlob } from '@/lib/receipt-image';

import { adminApi } from './admin-api';
import { DocumentViewerModal, type DocumentViewerDoc } from './DocumentViewerModal';

export function AdminUsersPage() {
  const { t } = useTranslation();
  const format = useFormatters();

  const [tab, setTab] = useState<UserListKind | 'VISITORS'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [verificationFilter, setVerificationFilter] = useState<VerificationStatus | ''>('');
  const [statusFilter, setStatusFilter] = useState<'ACTIVE' | 'INACTIVE' | ''>('');
  const [page, setPage] = useState(1);

  const [appliedFilters, setAppliedFilters] = useState<{
    q?: string;
    verification?: VerificationStatus;
    status?: 'ACTIVE' | 'INACTIVE';
    kind: UserListKind;
    page: number;
  }>({ kind: 'ALL', page: 1 });

  const countsQuery = useApiQuery(adminApi.userCounts, { refreshIntervalMs: 20_000 });
  const fetchUsers = useCallback(
    (signal: AbortSignal) =>
      adminApi.users(
        {
          kind: appliedFilters.kind,
          q: appliedFilters.q,
          verification: appliedFilters.verification,
          status: appliedFilters.status,
          page: appliedFilters.page,
          pageSize: 20,
        },
        signal,
      ),
    [appliedFilters],
  );
  const usersQuery = useApiQuery(fetchUsers);

  const fetchVisitors = useCallback(
    (signal: AbortSignal) => adminApi.visitors({ page, pageSize: 20 }, signal),
    [page],
  );
  const visitorsQuery = useApiQuery(fetchVisitors);

  // Selected user for detail modal
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [noticeDialogOpen, setNoticeDialogOpen] = useState(false);

  const handleTabChange = (nextTab: UserListKind | 'VISITORS') => {
    setTab(nextTab);
    setPage(1);
    if (nextTab !== 'VISITORS') {
      setAppliedFilters((prev) => ({ ...prev, kind: nextTab, page: 1 }));
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setAppliedFilters((prev) => ({
      ...prev,
      page: 1,
      q: searchQuery.trim() || undefined,
      verification: verificationFilter || undefined,
      status: statusFilter || undefined,
    }));
  };

  const counts = countsQuery.data;
  const usersList = usersQuery.data?.items ?? [];
  const usersTotal = usersQuery.data?.total ?? 0;
  const usersTotalPages = Math.ceil(usersTotal / 20);

  const visitorsList = visitorsQuery.data?.items ?? [];

  const refreshAll = () => {
    countsQuery.reload();
    if (tab === 'VISITORS') visitorsQuery.reload();
    else usersQuery.reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="User & Identity Management"
        description="Oversee Student, Staff and Visitor accounts, verify identity documents, and broadcast notices"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refreshAll}>
              <RefreshCw className="size-4" aria-hidden />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setNoticeDialogOpen(true)}
              className="gap-1.5"
            >
              <Send className="size-3.5" />
              Broadcast Notice
            </Button>
          </div>
        }
      />

      {/* High-level Count Cards */}
      {counts && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card
            onClick={() => handleTabChange('ALL')}
            className={`p-3 cursor-pointer transition-all ${
              tab === 'ALL' ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'
            }`}
          >
            <span className="text-[10px] font-bold uppercase text-muted-foreground block">
              All Accounts
            </span>
            <span className="font-mono text-2xl font-black">{counts.all}</span>
          </Card>

          <Card
            onClick={() => handleTabChange('STUDENT')}
            className={`p-3 cursor-pointer transition-all ${
              tab === 'STUDENT' ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'
            }`}
          >
            <span className="text-[10px] font-bold uppercase text-muted-foreground block">
              Students
            </span>
            <span className="font-mono text-2xl font-black text-primary">{counts.students}</span>
          </Card>

          <Card
            onClick={() => handleTabChange('STAFF')}
            className={`p-3 cursor-pointer transition-all ${
              tab === 'STAFF' ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'
            }`}
          >
            <span className="text-[10px] font-bold uppercase text-muted-foreground block">
              Campus Staff
            </span>
            <span className="font-mono text-2xl font-black text-indigo-600">{counts.staff}</span>
          </Card>

          <Card
            onClick={() => {
              setVerificationFilter('PENDING');
              setAppliedFilters((prev) => ({ ...prev, verification: 'PENDING', page: 1 }));
            }}
            className={`p-3 cursor-pointer transition-all ${
              counts.pendingVerification > 0
                ? 'border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                : ''
            }`}
          >
            <span className="text-[10px] font-bold uppercase block">
              Pending Verification
            </span>
            <span className="font-mono text-2xl font-black">{counts.pendingVerification}</span>
          </Card>

          <Card className="p-3">
            <span className="text-[10px] font-bold uppercase text-muted-foreground block">
              Active Parked Users
            </span>
            <span className="font-mono text-2xl font-black text-emerald-600">
              {counts.activeParkingUsers}
            </span>
          </Card>

          <Card
            onClick={() => handleTabChange('VISITORS')}
            className={`p-3 cursor-pointer transition-all ${
              tab === 'VISITORS' ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'
            }`}
          >
            <span className="text-[10px] font-bold uppercase text-muted-foreground block">
              Visitor Vehicles
            </span>
            <span className="font-mono text-2xl font-black">{counts.visitorVehicles}</span>
          </Card>
        </div>
      )}

      {/* Tabs & Filter Bar */}
      <Card className="p-4 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div className="flex flex-wrap gap-1">
            {(['ALL', 'STUDENT', 'STAFF', 'VISITORS'] as const).map((tName) => (
              <Button
                key={tName}
                variant={tab === tName ? 'default' : 'ghost'}
                size="sm"
                onClick={() => handleTabChange(tName)}
                className="h-8 text-xs font-semibold"
              >
                {tName === 'ALL'
                  ? 'All Users'
                  : tName === 'STUDENT'
                    ? 'Students'
                    : tName === 'STAFF'
                      ? 'Staff'
                      : 'Visitors'}
              </Button>
            ))}
          </div>

          {tab !== 'VISITORS' && (
            <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-2 text-xs">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, email, ID..."
                className="h-8 w-44"
              />

              <select
                value={verificationFilter}
                onChange={(e) => setVerificationFilter(e.target.value as VerificationStatus | '')}
                className="flex h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">All Verifications</option>
                <option value="PENDING">Pending</option>
                <option value="VERIFIED">Verified</option>
                <option value="REJECTED">Rejected</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'ACTIVE' | 'INACTIVE' | '')}
                className="flex h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>

              <Button type="submit" size="sm" className="h-8 text-xs gap-1">
                <Search className="size-3.5" />
                Filter
              </Button>
            </form>
          )}
        </div>

        {/* Content Table */}
        {tab !== 'VISITORS' ? (
          <div>
            {usersQuery.status === 'loading' && <LoadingState />}
            {usersQuery.status === 'error' && (
              <ErrorState description={errorMessage(t, usersQuery.error)} onRetry={usersQuery.refetch} />
            )}
            {usersQuery.status === 'success' && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Category / Role</TableHead>
                      <TableHead>Institutional ID</TableHead>
                      <TableHead>Verification</TableHead>
                      <TableHead>Vehicles</TableHead>
                      <TableHead>Current Parking</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usersList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                          No users found matching current filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      usersList.map((u: UserListItem) => (
                        <TableRow key={u.id} className="hover:bg-muted/40 text-xs">
                          <TableCell>
                            <span className="font-bold text-foreground block">{u.fullName}</span>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {u.parkingUser?.email || u.username}
                            </span>
                          </TableCell>

                          <TableCell>
                            <span className="font-semibold">
                              {u.parkingUser?.category || u.role}
                            </span>
                          </TableCell>

                          <TableCell className="font-mono font-bold text-primary">
                            {u.parkingUser?.institutionalId || '—'}
                          </TableCell>

                          <TableCell>
                            {u.parkingUser?.verificationStatus ? (
                              <Badge
                                variant={
                                  u.parkingUser.verificationStatus === 'VERIFIED'
                                    ? 'default'
                                    : u.parkingUser.verificationStatus === 'PENDING'
                                      ? 'secondary'
                                      : 'destructive'
                                }
                                className={`text-[10px] ${
                                  u.parkingUser.verificationStatus === 'VERIFIED'
                                    ? 'bg-emerald-600 text-white'
                                    : u.parkingUser.verificationStatus === 'PENDING'
                                      ? 'bg-amber-500 text-white'
                                      : ''
                                }`}
                              >
                                {u.parkingUser.verificationStatus}
                              </Badge>
                            ) : (
                              '—'
                            )}
                          </TableCell>

                          <TableCell className="font-mono">{u.vehicleCount}</TableCell>

                          <TableCell>
                            {u.currentParking ? (
                              <div className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                                <span className="size-1.5 rounded-full bg-emerald-500 animate-ping" />
                                <span>{u.currentParking.slotCode}</span>
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  ({u.currentParking.vehicleNumber})
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          <TableCell>
                            <Badge variant={u.isActive ? 'outline' : 'destructive'} className="text-[10px]">
                              {u.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>

                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => setSelectedUserId(u.id)}
                            >
                              <Eye className="size-3" />
                              Manage
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>

                {usersTotalPages > 1 && (
                  <div className="p-3 border-t flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Page {appliedFilters.page} of {usersTotalPages}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={appliedFilters.page <= 1}
                        onClick={() =>
                          setAppliedFilters((prev) => ({ ...prev, page: prev.page - 1 }))
                        }
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={appliedFilters.page >= usersTotalPages}
                        onClick={() =>
                          setAppliedFilters((prev) => ({ ...prev, page: prev.page + 1 }))
                        }
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Visitors Tab */
          <div>
            {visitorsQuery.status === 'loading' && <LoadingState />}
            {visitorsQuery.status === 'error' && (
              <ErrorState description={errorMessage(t, visitorsQuery.error)} onRetry={visitorsQuery.refetch} />
            )}
            {visitorsQuery.status === 'success' && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Session #</TableHead>
                      <TableHead>Block & Slot</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Fee</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visitorsList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                          No visitor sessions recorded yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      visitorsList.map((item: HistoryItem) => (
                        <TableRow key={item.sessionNumber} className="text-xs">
                          <TableCell className="font-mono font-bold">{item.vehicleNumber}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">
                            {item.sessionNumber}
                          </TableCell>
                          <TableCell>
                            {item.blockName} (Slot {item.slotCode})
                          </TableCell>
                          <TableCell>{format.dateTime(item.entryAt)}</TableCell>
                          <TableCell>{item.durationHours ?? 'Active'} hr(s)</TableCell>
                          <TableCell className="font-mono font-bold">
                            {item.feePaise !== null ? format.paise(item.feePaise) : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={item.status === 'ACTIVE' ? 'default' : 'secondary'} className="text-[10px]">
                              {item.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* User Detail & Decision Modal */}
      {selectedUserId && (
        <UserDetailDialog
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
          onChanged={() => {
            refreshAll();
          }}
        />
      )}

      {/* Broadcast Notice Dialog */}
      <BroadcastNoticeDialog
        open={noticeDialogOpen}
        onClose={() => setNoticeDialogOpen(false)}
      />
    </div>
  );
}

function UserDetailDialog({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormatters();

  const fetchUserDetail = useCallback((signal: AbortSignal) => adminApi.userDetail(userId, signal), [userId]);
  const query = useApiQuery(fetchUserDetail);
  const user = query.data;

  const [decisionPending, setDecisionPending] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const [rejectFormOpen, setRejectFormOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<DocumentViewerDoc | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const handleVerify = async () => {
    setDecisionPending(true);
    setActionError(null);
    try {
      await adminApi.decideVerification(userId, { decision: 'VERIFY' });
      query.reload();
      onChanged();
    } catch (err) {
      setActionError(errorMessage(t, err));
    } finally {
      setDecisionPending(false);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectionNote.trim()) {
      setActionError('Please enter a rejection reason.');
      return;
    }
    setDecisionPending(true);
    setActionError(null);
    try {
      await adminApi.decideVerification(userId, { decision: 'REJECT', note: rejectionNote.trim() });
      setRejectFormOpen(false);
      query.reload();
      onChanged();
    } catch (err) {
      setActionError(errorMessage(t, err));
    } finally {
      setDecisionPending(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!user) return;
    setDecisionPending(true);
    setActionError(null);
    try {
      await adminApi.setUserStatus(userId, !user.isActive);
      query.reload();
      onChanged();
    } catch (err) {
      setActionError(errorMessage(t, err));
    } finally {
      setDecisionPending(false);
    }
  };

  const handleDownloadDoc = async (docId: string, fileName: string) => {
    try {
      const { blob } = await adminApi.downloadDocument(userId, docId);
      downloadBlob(blob, fileName);
    } catch (err) {
      setActionError(errorMessage(t, err));
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDecisionPending(true);
    try {
      await adminApi.updateUser(userId, {
        fullName: fullName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setEditOpen(false);
      query.reload();
      onChanged();
    } catch (err) {
      setActionError(errorMessage(t, err));
    } finally {
      setDecisionPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between text-lg pr-6">
            <span>Manage User Account</span>
            {user && (
              <Badge variant={user.isActive ? 'outline' : 'destructive'} className="text-xs">
                {user.isActive ? 'Account Active' : 'Account Disabled'}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Review identity documents, decide verification, or manage status.
          </DialogDescription>
        </DialogHeader>

        {query.status === 'loading' && <LoadingState />}
        {query.status === 'error' && <ErrorState description={errorMessage(t, query.error)} />}

        {actionError && (
          <Alert variant="destructive">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}

        {user && (
          <div className="space-y-6 py-2 text-xs">
            {/* Identity Verification Review & Decision Area */}
            {user.parkingUser && (
              <div
                className={`rounded-xl border p-4 space-y-3.5 ${
                  user.parkingUser.verificationStatus === 'PENDING'
                    ? 'border-amber-500 bg-amber-500/10'
                    : user.parkingUser.verificationStatus === 'VERIFIED'
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-destructive bg-destructive/10'
                }`}
              >
                {/* Header row with Status & Account State */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/40 pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-primary shrink-0" />
                    <span className="font-bold text-sm">
                      {user.parkingUser.verificationStatus === 'VERIFIED' ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1.5">
                          ✓ VERIFIED
                        </span>
                      ) : (
                        `Identity Verification: ${user.parkingUser.verificationStatus}`
                      )}
                    </span>
                    <Badge
                      variant={
                        user.parkingUser.verificationStatus === 'VERIFIED'
                          ? 'default'
                          : user.parkingUser.verificationStatus === 'PENDING'
                            ? 'secondary'
                            : 'destructive'
                      }
                      className={
                        user.parkingUser.verificationStatus === 'VERIFIED'
                          ? 'bg-emerald-600 text-white text-[10px]'
                          : user.parkingUser.verificationStatus === 'PENDING'
                            ? 'bg-amber-500 text-white text-[10px]'
                            : 'text-[10px]'
                      }
                    >
                      {user.parkingUser.verificationStatus === 'VERIFIED'
                        ? '✓ VERIFIED'
                        : user.parkingUser.verificationStatus}
                    </Badge>
                  </div>
                  <Badge variant={user.isActive ? 'outline' : 'destructive'} className="text-xs shrink-0 w-fit">
                    Current Account Status: {user.isActive ? 'Active' : 'Disabled'}
                  </Badge>
                </div>

                {/* Reviewer Details Grid: Name, ID, Category, Account Status */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs py-1">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Student / User Name</span>
                    <span className="font-semibold text-foreground">{user.fullName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Student ID / USN</span>
                    <span className="font-mono font-bold text-foreground">{user.parkingUser.institutionalId}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Category</span>
                    <span className="font-semibold text-foreground">{user.parkingUser.category}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Account Status</span>
                    <span className={user.isActive ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-destructive'}>
                      {user.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                </div>

                {user.verification?.note && (
                  <div className="rounded-lg bg-destructive/15 border border-destructive/30 p-2 text-xs text-destructive">
                    <span className="font-bold">Rejection Note:</span> {user.verification.note}
                  </div>
                )}

                {/* Verification Decision Actions: Approve / Reject (Only if PENDING) */}
                {user.parkingUser.verificationStatus === 'PENDING' ? (
                  <div className="flex items-center gap-3 pt-1 border-t border-border/40">
                    <Button
                      size="sm"
                      onClick={handleVerify}
                      disabled={decisionPending}
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                    >
                      <CheckCircle2 className="size-3.5" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRejectFormOpen(true)}
                      disabled={decisionPending}
                      className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
                    >
                      <XCircle className="size-3.5" />
                      Reject
                    </Button>
                  </div>
                ) : user.parkingUser.verificationStatus === 'VERIFIED' ? (
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-medium text-xs pt-1 border-t border-border/40">
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>✓ Institutional identity verified and active. No further verification action required.</span>
                  </div>
                ) : null}
              </div>
            )}

            {/* Rejection Note Form */}
            {rejectFormOpen && (
              <form onSubmit={handleReject} className="rounded-xl border border-destructive/40 bg-card p-4 space-y-3">
                <Label htmlFor="rej-note" className="text-destructive font-bold">
                  Rejection Reason (Mandatory)
                </Label>
                <Input
                  id="rej-note"
                  value={rejectionNote}
                  onChange={(e) => setRejectionNote(e.target.value)}
                  placeholder="e.g. Identity card photo is blurry / USN mismatch"
                  required
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRejectFormOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="destructive" size="sm" disabled={decisionPending}>
                    Confirm Rejection
                  </Button>
                </div>
              </form>
            )}

            {/* Uploaded Identity Documents with VIEW DOCUMENT and DOWNLOAD actions */}
            <div className="space-y-2">
              <span className="font-bold uppercase tracking-wider text-muted-foreground text-[11px]">
                Uploaded Identity Documents ({user.documents.length})
              </span>
              {user.documents.length === 0 ? (
                <div className="p-4 rounded-lg border text-center text-muted-foreground">
                  No documents uploaded for this account.
                </div>
              ) : (
                <div className="space-y-2">
                  {user.documents.map((doc) => {
                    const isPdf = doc.mimeType === 'application/pdf';
                    const isImage = doc.mimeType.startsWith('image/');
                    const typeLabel = isPdf
                      ? 'PDF Document'
                      : doc.mimeType.includes('png')
                        ? 'PNG Image'
                        : isImage
                          ? 'JPEG Image'
                          : doc.mimeType;

                    return (
                      <div
                        key={doc.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border bg-muted/20 gap-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileText className="size-5 text-primary shrink-0" />
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold block truncate">{doc.fileName}</span>
                              <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                                {typeLabel}
                              </Badge>
                            </div>
                            <span className="text-[10px] text-muted-foreground block">
                              {(doc.sizeBytes / 1024).toFixed(1)} KB · Uploaded {format.dateTime(doc.uploadedAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setViewingDoc({
                                id: doc.id,
                                fileName: doc.fileName,
                                mimeType: doc.mimeType,
                                sizeBytes: doc.sizeBytes,
                                uploadedAt: doc.uploadedAt,
                                institutionalId: user.parkingUser?.institutionalId,
                              })
                            }
                            className="gap-1.5 h-8 text-xs font-medium"
                          >
                            <Eye className="size-3.5" />
                            VIEW DOCUMENT
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleDownloadDoc(doc.id, doc.fileName)}
                            className="gap-1.5 h-8 text-xs font-medium"
                          >
                            <Download className="size-3.5" />
                            DOWNLOAD
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Profile Overview */}
            <div className="grid sm:grid-cols-2 gap-4 rounded-xl border p-4 bg-card">
              <div>
                <span className="text-muted-foreground block">Full Name</span>
                <span className="font-bold text-sm text-foreground">{user.fullName}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Username / Email</span>
                <span className="font-mono text-sm text-foreground">
                  {user.parkingUser?.email || user.username}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Phone</span>
                <span className="font-mono text-sm text-foreground">
                  {user.parkingUser?.phone || '—'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Role</span>
                <span className="font-bold text-sm text-foreground">{user.role}</span>
              </div>
            </div>

            {/* Registered Vehicles */}
            <div className="space-y-2">
              <span className="font-bold uppercase tracking-wider text-muted-foreground text-[11px]">
                Registered Vehicles ({user.vehicles.length})
              </span>
              <div className="grid sm:grid-cols-2 gap-2">
                {user.vehicles.map((v) => (
                  <div key={v.id} className="p-2.5 rounded-lg border bg-muted/20 flex justify-between items-center">
                    <div>
                      <span className="font-mono font-bold block">{v.vehicleNumber}</span>
                      <span className="text-[10px] text-muted-foreground">{v.label || v.vehicleType}</span>
                    </div>
                    {v.isPrimary && <Badge variant="secondary" className="text-[9px]">Primary</Badge>}
                  </div>
                ))}
              </div>
            </div>

            {/* Status & Edit Actions */}
            <div className="flex items-center justify-between pt-4 border-t">
              <Button
                variant={user.isActive ? 'destructive' : 'default'}
                size="sm"
                onClick={handleToggleStatus}
                disabled={decisionPending}
                className="gap-1.5 text-xs"
              >
                <Power className="size-3.5" />
                {user.isActive ? 'Deactivate Account' : 'Activate Account'}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFullName(user.fullName);
                  setEmail(user.parkingUser?.email || '');
                  setPhone(user.parkingUser?.phone || '');
                  setEditOpen(true);
                }}
                className="gap-1.5 text-xs"
              >
                <Edit2 className="size-3.5" />
                Edit Details
              </Button>
            </div>

            {/* Edit Dialog */}
            {editOpen && (
              <form onSubmit={handleSaveEdit} className="p-4 rounded-xl border bg-muted/30 space-y-3">
                <h4 className="font-bold">Edit Account Details</h4>
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="ed-n">Full Name</Label>
                    <Input id="ed-n" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="ed-e">Email</Label>
                    <Input id="ed-e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="ed-p">Phone</Label>
                    <Input id="ed-p" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={decisionPending}>
                    Save
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </DialogContent>

      {viewingDoc && (
        <DocumentViewerModal
          isOpen={Boolean(viewingDoc)}
          onClose={() => setViewingDoc(null)}
          userId={userId}
          userName={user?.fullName}
          document={viewingDoc}
        />
      )}
    </Dialog>
  );
}

function BroadcastNoticeDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [audience, setAudience] = useState<'ALL' | 'STUDENTS' | 'STAFF'>('ALL');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.sendNotice({
        audience,
        title: title.trim(),
        message: message.trim(),
      });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setTitle('');
        setMessage('');
        onClose();
      }, 1500);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Broadcast Campus Parking Notice</DialogTitle>
            <DialogDescription>
              Send an official notice directly to the notification bell of all or selected users.
            </DialogDescription>
          </DialogHeader>

          {success && (
            <Alert variant="success">
              <CheckCircle2 className="size-4" />
              <AlertDescription>Notice successfully broadcasted to users!</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bc-aud">Target Audience</Label>
              <select
                id="bc-aud"
                value={audience}
                onChange={(e) => setAudience(e.target.value as 'ALL' | 'STUDENTS' | 'STAFF')}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="ALL">All Users (Students & Staff)</option>
                <option value="STUDENTS">Students Only</option>
                <option value="STAFF">Campus Staff Only</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bc-title">Notice Title</Label>
              <Input
                id="bc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Block B Surface Maintenance on Monday"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bc-msg">Notice Message</Label>
              <textarea
                id="bc-msg"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className="flex w-full rounded-md border border-input bg-background p-2.5 text-xs shadow-xs focus-visible:outline-none"
                placeholder="Provide detailed instructions or updates for campus parkers..."
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={loading} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="gap-1.5">
              {loading && <LoaderCircle className="size-4 animate-spin" />}
              Send Broadcast
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
