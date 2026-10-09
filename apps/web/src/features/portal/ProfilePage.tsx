import type {
  IdentityDocumentType,
  Locale,
} from '@cpvts/shared';
import {
  Building,
  CheckCircle2,
  Clock,
  Edit2,
  FileText,
  LoaderCircle,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  User,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useAuth, useCurrentUser } from '@/features/auth/use-auth';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';

import { portalApi } from './portal-api';

export function ProfilePage() {
  const { t, i18n } = useTranslation();
  const format = useFormatters();
  const { user } = useCurrentUser();
  const { refreshUser } = useAuth();

  const query = useApiQuery(portalApi.profile);
  const profile = query.data;

  // Sync auth state if backend verification status differs
  useEffect(() => {
    if (
      profile?.verification.status &&
      profile.verification.status !== user.parkingUser?.verificationStatus
    ) {
      void refreshUser();
    }
  }, [profile?.verification.status, user.parkingUser?.verificationStatus, refreshUser]);

  const [editOpen, setEditOpen] = useState(false);
  const [resubmitOpen, setResubmitOpen] = useState(false);

  // Edit fields
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [locale, setLocale] = useState('');
  const [updating, setUpdating] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Resubmit fields
  const [instId, setInstId] = useState('');
  const [confirmInstId, setConfirmInstId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>('');
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitError, setResubmitError] = useState<string | null>(null);
  const [resubmitSuccess, setResubmitSuccess] = useState(false);

  const openEditDialog = () => {
    if (!profile) return;
    setFullName(profile.fullName);
    setPhone(profile.phone);
    setLocale(profile.preferredLocale || i18n.language);
    setEditError(null);
    setEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    setEditError(null);
    try {
      await portalApi.updateProfile({
        fullName: fullName.trim() || undefined,
        phone: phone.trim() || undefined,
        preferredLocale: (locale as Locale) || undefined,
      });
      if (locale && locale !== i18n.language) {
        void i18n.changeLanguage(locale);
      }
      setEditOpen(false);
      query.reload();
      void refreshUser();
    } catch (err) {
      setEditError(errorMessage(t, err));
    } finally {
      setUpdating(false);
    }
  };

  const openResubmitDialog = () => {
    if (!profile) return;
    setInstId(profile.institutionalId);
    setConfirmInstId(profile.institutionalId);
    setSelectedFile(null);
    setFileBase64('');
    setResubmitError(null);
    setResubmitSuccess(false);
    setResubmitOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setResubmitError('The file is larger than 2 MB. Please select a smaller file.');
      return;
    }

    const acceptedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!acceptedTypes.includes(file.type)) {
      setResubmitError('Please select a JPEG, PNG or PDF file.');
      return;
    }

    setResubmitError(null);
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const base64 = res.split(',')[1] || '';
      setFileBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleResubmitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !fileBase64) {
      setResubmitError('Please upload your identity document.');
      return;
    }
    if (instId.trim() !== confirmInstId.trim()) {
      setResubmitError('Institutional IDs do not match.');
      return;
    }

    setResubmitting(true);
    setResubmitError(null);
    try {
      await portalApi.resubmitVerification({
        institutionalId: instId.trim().toUpperCase(),
        confirmInstitutionalId: confirmInstId.trim().toUpperCase(),
        document: {
          fileName: selectedFile.name,
          mimeType: selectedFile.type as IdentityDocumentType,
          contentBase64: fileBase64,
        },
      });
      setResubmitSuccess(true);
      query.reload();
      void refreshUser();
      setTimeout(() => {
        setResubmitOpen(false);
      }, 1500);
    } catch (err) {
      setResubmitError(errorMessage(t, err));
    } finally {
      setResubmitting(false);
    }
  };

  const vStatus = profile?.verification.status;
  const isPending = vStatus === 'PENDING';
  const isVerified = vStatus === 'VERIFIED';
  const isRejected = vStatus === 'REJECTED';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Profile & Identity"
        description="Your institutional credentials and verification status"
        actions={
          <Button variant="outline" size="sm" onClick={openEditDialog} className="gap-1.5">
            <Edit2 className="size-3.5" />
            Edit Profile
          </Button>
        }
      />

      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}

      {query.status === 'success' && profile && (
        <div className="space-y-6">
          {/* Verification Status Card */}
          <Card
            className={`border-2 p-6 shadow-xs ${
              isVerified
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : isPending
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-destructive/30 bg-destructive/5'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div
                  className={`flex size-12 items-center justify-center rounded-2xl shrink-0 ${
                    isVerified
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : isPending
                        ? 'bg-amber-500/10 text-amber-600'
                        : 'bg-destructive/10 text-destructive'
                  }`}
                >
                  {isVerified ? (
                    <ShieldCheck className="size-6" />
                  ) : isPending ? (
                    <Clock className="size-6" />
                  ) : (
                    <ShieldAlert className="size-6" />
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        isVerified
                          ? 'bg-emerald-600 text-white'
                          : isPending
                            ? 'bg-amber-500 text-white'
                            : 'bg-destructive text-white'
                      }
                    >
                      {isVerified
                        ? 'VERIFIED'
                        : isPending
                          ? 'PENDING VERIFICATION'
                          : 'VERIFICATION REJECTED'}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">
                      Category: {profile.category}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold">
                    {isVerified
                      ? 'Institutional Identity Approved'
                      : isPending
                        ? 'Under Administrator Review'
                        : 'Document Review Requires Resubmission'}
                  </h3>

                  <p className="text-xs text-muted-foreground max-w-lg">
                    {isVerified
                      ? 'Your account has full access to campus parking and automatic slot allocation.'
                      : isPending
                        ? 'Submitted document is being reviewed. Parking features will activate upon approval.'
                        : profile.verification.note ||
                          'Your document did not meet verification criteria. Please resubmit an updated file.'}
                  </p>
                </div>
              </div>

              {isRejected && (
                <Button onClick={openResubmitDialog} className="gap-2 shrink-0">
                  <RotateCcw className="size-4" />
                  Resubmit Document
                </Button>
              )}
            </div>
          </Card>

          {/* User Details Grid */}
          <div className="grid sm:grid-cols-2 gap-6">
            <Card className="shadow-xs">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <User className="size-4 text-primary" />
                  Personal Information
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3 text-xs">
                <div>
                  <span className="text-muted-foreground block font-medium">Full Name</span>
                  <span className="text-sm font-bold text-foreground">{profile.fullName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block font-medium">Email Address</span>
                  <span className="text-sm font-mono text-foreground">{profile.email}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block font-medium">Phone Number</span>
                  <span className="text-sm font-mono text-foreground">{profile.phone}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block font-medium">Language</span>
                  <span className="text-sm font-medium text-foreground">
                    {profile.preferredLocale ? profile.preferredLocale.toUpperCase() : 'Default'}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-xs">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Building className="size-4 text-primary" />
                  Institutional Details
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3 text-xs">
                <div>
                  <span className="text-muted-foreground block font-medium">
                    Institutional ID (USN / Employee ID)
                  </span>
                  <span className="text-sm font-mono font-bold text-primary">
                    {profile.institutionalId}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block font-medium">Account Category</span>
                  <span className="text-sm font-bold text-foreground">{profile.category}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block font-medium">
                    Registered Vehicles
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-sm font-bold">{profile.vehicleCount} vehicle(s)</span>
                    <Button variant="ghost" size="sm" asChild className="h-6 text-xs text-primary">
                      <Link to="/portal/vehicles">Manage Vehicles</Link>
                    </Button>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground block font-medium">Member Since</span>
                  <span className="text-sm text-foreground">
                    {format.date(profile.memberSince)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Edit Profile Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent closeLabel={t('common.close')}>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Edit Profile Information</DialogTitle>
              <DialogDescription>
                Update your contact details or language preference.
              </DialogDescription>
            </DialogHeader>

            {editError && (
              <Alert variant="destructive">
                <AlertDescription>{editError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Full Name</Label>
                <Input
                  id="edit-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-phone">Phone Number</Label>
                <Input
                  id="edit-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-locale">Preferred Language</Label>
                <select
                  id="edit-locale"
                  value={locale}
                  onChange={(e) => setLocale(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none"
                >
                  <option value="en">English</option>
                  <option value="kn">ಕನ್ನಡ (Kannada)</option>
                  <option value="hi">हिन्दी (Hindi)</option>
                  <option value="mr">मराठी (Marathi)</option>
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={updating}
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updating}>
                {updating && <LoaderCircle className="size-4 animate-spin mr-1.5" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Resubmit Verification Document Dialog */}
      <Dialog open={resubmitOpen} onOpenChange={setResubmitOpen}>
        <DialogContent closeLabel={t('common.close')}>
          <form onSubmit={handleResubmitSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Resubmit Verification Document</DialogTitle>
              <DialogDescription>
                Upload a clear copy of your student ID card or employee badge (JPEG, PNG, PDF up to 2 MB).
              </DialogDescription>
            </DialogHeader>

            {resubmitSuccess && (
              <Alert variant="success">
                <CheckCircle2 className="size-4" />
                <AlertDescription>Document resubmitted! Account is now Pending review.</AlertDescription>
              </Alert>
            )}

            {resubmitError && (
              <Alert variant="destructive">
                <AlertDescription>{resubmitError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="resubmit-id">Institutional ID (USN / Emp ID)</Label>
                <Input
                  id="resubmit-id"
                  value={instId}
                  onChange={(e) => setInstId(e.target.value.toUpperCase())}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="resubmit-confirm-id">Confirm Institutional ID</Label>
                <Input
                  id="resubmit-confirm-id"
                  value={confirmInstId}
                  onChange={(e) => setConfirmInstId(e.target.value.toUpperCase())}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="resubmit-file">Upload Identity Document (JPEG, PNG, PDF &le; 2 MB)</Label>
                <Input
                  id="resubmit-file"
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  onChange={handleFileChange}
                  required
                />
                {selectedFile && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
                    <FileText className="size-3.5 text-primary" />
                    Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={resubmitting}
                onClick={() => setResubmitOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={resubmitting || !selectedFile}>
                {resubmitting && <LoaderCircle className="size-4 animate-spin mr-1.5" />}
                Submit for Verification
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
