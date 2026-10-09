import type {
  CreateSecurityStaffRequest,
  CreateShiftRequest,
  CreateShiftTemplateRequest,
  SecurityStaffMember,
  ShiftTemplateView,
  ShiftView,
} from '@cpvts/shared';
import {
  Calendar,
  Clock,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { useCallback, useState } from 'react';
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

export function AdminShiftsPage() {
  const { t } = useTranslation();
  const format = useFormatters();

  const todayStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  const fetchRoster = useCallback(
    (signal: AbortSignal) => adminShiftsApi.roster(selectedDate, signal),
    [selectedDate],
  );
  const rosterQuery = useApiQuery(fetchRoster, { refreshIntervalMs: 15_000 });
  const templatesQuery = useApiQuery(() => adminShiftsApi.templates({ includeInactive: true }));
  const staffQuery = useApiQuery(adminShiftsApi.securityStaff);

  // Modals state
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [staffDialogOpen, setStaffDialogOpen] = useState(false);

  // Form states
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Assign shift state
  const [assignStaffId, setAssignStaffId] = useState('');
  const [assignTemplateId, setAssignTemplateId] = useState('');
  const [assignGate, setAssignGate] = useState('Main Gate');

  // Create template state
  const [templateName, setTemplateName] = useState('');
  const [templateStart, setTemplateStart] = useState('08:00');
  const [templateEnd, setTemplateEnd] = useState('16:00');
  const [templateGate, setTemplateGate] = useState('Main Gate');

  // Create security staff state
  const [staffUsername, setStaffUsername] = useState('');
  const [staffFullName, setStaffFullName] = useState('');
  const [staffPassword, setStaffPassword] = useState('');

  const roster = rosterQuery.data;
  const templates = templatesQuery.data ?? [];
  const staffList = staffQuery.data ?? [];

  const handleAssignShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignStaffId) return;
    setSubmitting(true);
    setModalError(null);
    try {
      if (!assignTemplateId) {
        setModalError('Please select a shift template.');
        setSubmitting(false);
        return;
      }
      const payload: CreateShiftRequest = {
        staffId: assignStaffId,
        date: selectedDate,
        templateId: assignTemplateId,
        gate: assignGate ? assignGate.trim() : undefined,
      };
      await adminShiftsApi.assign(payload);
      setAssignDialogOpen(false);
      rosterQuery.reload();
    } catch (err) {
      setModalError(errorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateName) return;
    setSubmitting(true);
    setModalError(null);
    try {
      const payload: CreateShiftTemplateRequest = {
        name: templateName,
        startTime: templateStart,
        endTime: templateEnd,
      };
      await adminShiftsApi.createTemplate(payload);
      setTemplateDialogOpen(false);
      templatesQuery.reload();
      setTemplateName('');
    } catch (err) {
      setModalError(errorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffUsername || !staffFullName || !staffPassword) return;
    setSubmitting(true);
    setModalError(null);
    try {
      const payload: CreateSecurityStaffRequest = {
        username: staffUsername,
        fullName: staffFullName,
        password: staffPassword,
      };
      await adminShiftsApi.createSecurityStaff(payload);
      setStaffDialogOpen(false);
      staffQuery.reload();
      setStaffUsername('');
      setStaffFullName('');
      setStaffPassword('');
    } catch (err) {
      setModalError(errorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminCheckOut = async (shiftId: string) => {
    try {
      await adminShiftsApi.adminCheckOut(shiftId);
      rosterQuery.reload();
    } catch (err) {
      alert(errorMessage(t, err));
    }
  };

  const handleCancelShift = async (shiftId: string) => {
    if (!confirm('Cancel this scheduled shift?')) return;
    try {
      await adminShiftsApi.cancel(shiftId);
      rosterQuery.reload();
    } catch (err) {
      alert(errorMessage(t, err));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Staff & Shift Management"
        description="Gate rosters, duty templates, shift status, and operational assignments"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                rosterQuery.reload();
                templatesQuery.reload();
                staffQuery.reload();
              }}
            >
              <RefreshCw className="size-4" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setAssignDialogOpen(true)} className="gap-1.5">
              <Plus className="size-4" />
              Assign Shift
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="roster" className="space-y-4">
        <TabsList>
          <TabsTrigger value="roster" className="gap-1.5">
            <Calendar className="size-4" />
            Daily Roster
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <Clock className="size-4" />
            Shift Templates
          </TabsTrigger>
          <TabsTrigger value="staff" className="gap-1.5">
            <Users className="size-4" />
            Security Personnel
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Daily Roster */}
        <TabsContent value="roster" className="space-y-4">
          <Card>
            <CardHeader className="pb-3 border-b">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-bold">Roster for {selectedDate}</CardTitle>
                  <CardDescription className="text-xs">
                    Shifts assigned to campus security guards for this date
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="roster-date" className="text-xs font-medium">
                    Date:
                  </Label>
                  <Input
                    id="roster-date"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-40 h-8 text-xs font-mono"
                  />
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-4">
              {rosterQuery.status === 'loading' && <LoadingState />}
              {rosterQuery.status === 'error' && (
                <ErrorState
                  description={errorMessage(t, rosterQuery.error)}
                  onRetry={rosterQuery.refetch}
                />
              )}

              {roster && (
                <div className="space-y-6">
                  {/* Shifts List */}
                  {roster.shifts.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground border rounded-lg border-dashed">
                      No shifts assigned for {selectedDate}. Click &quot;Assign Shift&quot; to assign personnel.
                    </div>
                  ) : (
                    <div className="divide-y rounded-lg border">
                      {roster.shifts.map((shift: ShiftView) => (
                        <div
                          key={shift.id}
                          className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-foreground">
                                {shift.staff.fullName}
                              </span>
                              <Badge
                                variant={shift.onDuty ? 'default' : 'secondary'}
                                className={shift.onDuty ? 'bg-emerald-600' : ''}
                              >
                                {shift.status}
                              </Badge>
                              {shift.flags.map((flag) => (
                                <Badge key={flag} variant="destructive" className="text-[10px]">
                                  {flag}
                                </Badge>
                              ))}
                            </div>
                            <p className="text-muted-foreground font-mono">
                              {shift.name} · {shift.gate ?? 'All Gates'} · {format.time(shift.startsAt)} – {format.time(shift.endsAt)}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              Cash Collected: {format.paise(shift.cash.expectedCashPaise)} ({shift.cash.cashTransactions} txns) · Digital: {format.paise(shift.cash.digitalPaise)}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-center">
                            {shift.onDuty && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAdminCheckOut(shift.id)}
                                className="text-xs h-7"
                              >
                                Force Check-out
                              </Button>
                            )}
                            {shift.status === 'SCHEDULED' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleCancelShift(shift.id)}
                                className="text-xs h-7 text-destructive hover:bg-destructive/10"
                              >
                                Cancel
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Unassigned Staff */}
                  {roster.unassignedStaff.length > 0 && (
                    <div className="rounded-lg border bg-muted/20 p-3 space-y-1.5">
                      <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <Users className="size-3.5" />
                        Unassigned Staff for this day:
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {roster.unassignedStaff.map((u) => (
                          <Badge key={u.id} variant="outline" className="text-xs">
                            {u.fullName} ({u.username})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Shift Templates */}
        <TabsContent value="templates" className="space-y-4">
          <Card>
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold">Shift Templates</CardTitle>
                <CardDescription className="text-xs">
                  Configured shifts (e.g. Morning, Afternoon, Night)
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setTemplateDialogOpen(true)} className="gap-1.5">
                <Plus className="size-4" />
                Add Template
              </Button>
            </CardHeader>
            <CardContent className="pt-4">
              {templatesQuery.status === 'loading' && <LoadingState />}
              {templates.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground border rounded-lg border-dashed">
                  No shift templates configured.
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {templates.map((tpl: ShiftTemplateView) => (
                    <div key={tpl.id} className="p-3.5 rounded-xl border bg-card space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-sm">{tpl.name}</h4>
                        <Badge variant={tpl.isActive ? 'default' : 'secondary'} className="text-[10px]">
                          {tpl.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">
                        {tpl.startTime} – {tpl.endTime}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Security Personnel */}
        <TabsContent value="staff" className="space-y-4">
          <Card>
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold">Security Staff Accounts</CardTitle>
                <CardDescription className="text-xs">
                  Active security operators eligible for gate duty
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setStaffDialogOpen(true)} className="gap-1.5">
                <UserPlus className="size-4" />
                Add Personnel
              </Button>
            </CardHeader>
            <CardContent className="pt-4">
              {staffQuery.status === 'loading' && <LoadingState />}
              {staffList.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground border rounded-lg border-dashed">
                  No security personnel accounts found.
                </div>
              ) : (
                <div className="divide-y rounded-lg border">
                  {staffList.map((guard: SecurityStaffMember) => (
                    <div key={guard.id} className="p-3.5 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-foreground">{guard.fullName}</span>
                          <span className="font-mono text-muted-foreground">({guard.username})</span>
                          <Badge variant={guard.isActive ? 'outline' : 'secondary'} className="text-[10px]">
                            {guard.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        {guard.onDutyShift ? (
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 block">
                            On duty: {guard.onDutyShift.name} ({guard.onDutyShift.gate ?? 'Gate'})
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground mt-0.5 block">
                            Off duty
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {guard.lastLoginAt ? `Last login: ${format.dateTime(guard.lastLoginAt)}` : 'Never logged in'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog: Assign Shift */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleAssignShift} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Assign Duty Shift</DialogTitle>
              <DialogDescription className="text-xs">
                Assign a security personnel to gate duty for {selectedDate}.
              </DialogDescription>
            </DialogHeader>

            {modalError && (
              <Alert variant="destructive">
                <ShieldAlert className="size-4" />
                <AlertDescription className="text-xs">{modalError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <Label htmlFor="staff-select" className="text-xs">Security Guard</Label>
                <select
                  id="staff-select"
                  value={assignStaffId}
                  onChange={(e) => setAssignStaffId(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-xs"
                  required
                >
                  <option value="">Select guard...</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.username})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="template-select" className="text-xs">Shift Template</Label>
                <select
                  id="template-select"
                  value={assignTemplateId}
                  onChange={(e) => setAssignTemplateId(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-xs"
                >
                  <option value="">Select template (or default 08:00-16:00)...</option>
                  {templates.filter((x) => x.isActive).map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name} ({tpl.startTime} - {tpl.endTime})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="gate-input" className="text-xs">Assigned Gate</Label>
                <Input
                  id="gate-input"
                  value={assignGate}
                  onChange={(e) => setAssignGate(e.target.value)}
                  placeholder="Main Gate"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setAssignDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting || !assignStaffId}>
                {submitting && <LoaderCircle className="size-3.5 animate-spin mr-1" />}
                Assign Duty
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Create Template */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateTemplate} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add Shift Template</DialogTitle>
              <DialogDescription className="text-xs">
                Create a standard duty template with fixed start and end hours.
              </DialogDescription>
            </DialogHeader>

            {modalError && (
              <Alert variant="destructive">
                <ShieldAlert className="size-4" />
                <AlertDescription className="text-xs">{modalError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <Label htmlFor="tpl-name" className="text-xs">Template Name</Label>
                <Input
                  id="tpl-name"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g. Morning Duty"
                  required
                  className="mt-1 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="tpl-start" className="text-xs">Start Time (HH:MM)</Label>
                  <Input
                    id="tpl-start"
                    value={templateStart}
                    onChange={(e) => setTemplateStart(e.target.value)}
                    placeholder="08:00"
                    required
                    className="mt-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <Label htmlFor="tpl-end" className="text-xs">End Time (HH:MM)</Label>
                  <Input
                    id="tpl-end"
                    value={templateEnd}
                    onChange={(e) => setTemplateEnd(e.target.value)}
                    placeholder="16:00"
                    required
                    className="mt-1 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="tpl-gate" className="text-xs">Default Gate (Optional)</Label>
                <Input
                  id="tpl-gate"
                  value={templateGate}
                  onChange={(e) => setTemplateGate(e.target.value)}
                  placeholder="Main Gate"
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setTemplateDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting || !templateName}>
                {submitting && <LoaderCircle className="size-3.5 animate-spin mr-1" />}
                Create Template
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Create Security Staff */}
      <Dialog open={staffDialogOpen} onOpenChange={setStaffDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateStaff} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add Security Personnel</DialogTitle>
              <DialogDescription className="text-xs">
                Register a new security staff member account.
              </DialogDescription>
            </DialogHeader>

            {modalError && (
              <Alert variant="destructive">
                <ShieldAlert className="size-4" />
                <AlertDescription className="text-xs">{modalError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <Label htmlFor="staff-full" className="text-xs">Full Name</Label>
                <Input
                  id="staff-full"
                  value={staffFullName}
                  onChange={(e) => setStaffFullName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  required
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <Label htmlFor="staff-user" className="text-xs">Username</Label>
                <Input
                  id="staff-user"
                  value={staffUsername}
                  onChange={(e) => setStaffUsername(e.target.value)}
                  placeholder="e.g. security2"
                  required
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <Label htmlFor="staff-pass" className="text-xs">Initial Password</Label>
                <Input
                  id="staff-pass"
                  type="password"
                  value={staffPassword}
                  onChange={(e) => setStaffPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  required
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setStaffDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting || !staffUsername || !staffFullName || !staffPassword}>
                {submitting && <LoaderCircle className="size-3.5 animate-spin mr-1" />}
                Create Account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
