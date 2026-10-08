import {
  emailSchema,
  fullNameSchema,
  phoneSchema,
  type IdentityDocumentInfo,
  type UserDetail,
} from '@cpvts/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft,
  BadgeCheck,
  CircleAlert,
  FileText,
  LoaderCircle,
  Pencil,
  Power,
  PowerOff,
  ShieldX,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { z } from 'zod';

import { PATHS, areaPaths } from '@/app/paths';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { StatusBadge } from '@/components/feedback/StatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { PlateBadge } from '@/components/parking/PlateBadge';
import { SessionRow } from '@/components/user/SessionRow';
import { VerificationBadge } from '@/components/user/VerificationBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';
import { formatFileSize } from '@/lib/identity-document';
import { formatHour } from '@/lib/format';

import { adminApi } from './admin-api';
import { Pager } from './Pager';

const adminPaths = areaPaths('ADMIN');

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
    <dt className="text-sm text-muted-foreground">{label}</dt>
    <dd className="min-w-0 text-sm font-medium break-words">{children}</dd>
  </div>
);

/** One account: information, verification, vehicles, parking history and receipts. */
export function UserDetailPage() {
  const { t } = useTranslation();
  const { userId = '' } = useParams();
  const fetcher = useCallback((signal: AbortSignal) => adminApi.user(userId, signal), [userId]);
  const query = useApiQuery(fetcher);
  const [dialog, setDialog] = useState<'edit' | 'reject' | 'document' | null>(null);
  const [document, setDocument] = useState<IdentityDocumentInfo | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      query.reload();
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
      <Link to={PATHS.admin.users}>
        <ArrowLeft aria-hidden />
        {t('adminUsers.title')}
      </Link>
    </Button>
  );

  if (query.status === 'loading') return <LoadingState />;
  if (query.status === 'error') {
    return (
      <>
        {back}
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      </>
    );
  }
  const user = query.data;
  const profile = user.parkingUser;

  return (
    <>
      {back}
      <PageHeader
        title={user.fullName}
        description={
          profile
            ? `${t(`ownerCategories.${profile.category}`)} · ${profile.institutionalId}`
            : t(`roles.${user.role}`)
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog('edit')}>
              <Pencil aria-hidden />
              {t('adminUsers.edit')}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => adminApi.setUserActive(user.id, !user.isActive))}
            >
              {user.isActive ? <PowerOff aria-hidden /> : <Power aria-hidden />}
              {user.isActive ? t('adminUsers.deactivate') : t('adminUsers.activate')}
            </Button>
          </>
        }
      />

      {actionError !== null && (
        <Alert variant="destructive" className="mb-6">
          <CircleAlert aria-hidden />
          <AlertDescription>{errorMessage(t, actionError)}</AlertDescription>
        </Alert>
      )}

      <div className="max-w-4xl space-y-10">
        {user.verification && profile && (
          <Section id="user-verification" title={t('adminUsers.sections.verification')}>
            <div className="flex flex-wrap items-center gap-3">
              <VerificationBadge status={user.verification.status} />
              <span className="text-sm text-muted-foreground">
                {t('verification.submitted')}:{' '}
                <VerificationDate value={user.verification.submittedAt} />
              </span>
            </div>
            {user.verification.note && (
              <p className="text-sm">
                <span className="text-muted-foreground">{t('verification.reason')}: </span>
                {user.verification.note}
              </p>
            )}
            {user.verification.reviewedBy && user.verification.reviewedAt && (
              <p className="text-sm text-muted-foreground">
                {t('adminUsers.reviewedBy', { name: user.verification.reviewedBy })} ·{' '}
                <VerificationDate value={user.verification.reviewedAt} />
              </p>
            )}
            <ul className="divide-y rounded-xl border bg-card">
              {user.documents.map((entry, index) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      <span translate="no">{entry.institutionalId}</span> ·{' '}
                      {formatFileSize(entry.sizeBytes)} ·{' '}
                      <VerificationDate value={entry.uploadedAt} />
                      {index === 0 && ` · ${t('adminUsers.latestDocument')}`}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDocument(entry);
                      setDialog('document');
                    }}
                  >
                    {t('adminUsers.viewDocument')}
                  </Button>
                </li>
              ))}
            </ul>
            {user.verification.status === 'PENDING' && (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(() => adminApi.decideVerification(user.id, { decision: 'VERIFY' }))
                  }
                >
                  <BadgeCheck aria-hidden />
                  {t('adminUsers.verify')}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setDialog('reject')}>
                  <ShieldX aria-hidden />
                  {t('adminUsers.reject')}
                </Button>
              </div>
            )}
          </Section>
        )}

        <Section id="user-info" title={t('adminUsers.sections.information')}>
          <dl className="divide-y border-y">
            <Row label={t('userAuth.register.fullName')}>{user.fullName}</Row>
            {profile ? (
              <>
                <Row label={t('userAuth.email')}>{profile.email}</Row>
                <Row label={t('userAuth.register.phone')}>{profile.phone}</Row>
              </>
            ) : (
              <Row label={t('account.username')}>{user.username}</Row>
            )}
            <Row label={t('adminUsers.accountStatus')}>
              <StatusBadge tone={user.isActive ? 'success' : 'neutral'} dot>
                {t(`adminUsers.accountStatuses.${user.isActive ? 'ACTIVE' : 'INACTIVE'}`)}
              </StatusBadge>
            </Row>
            <Row label={t('account.lastSignIn')}>
              {user.lastLoginAt ? (
                <VerificationDate value={user.lastLoginAt} />
              ) : (
                t('account.never')
              )}
            </Row>
            <Row label={t('user.profile.memberSince')}>
              <VerificationDate value={user.createdAt} />
            </Row>
          </dl>
        </Section>

        {profile && (
          <>
            <Section id="user-vehicles" title={t('adminUsers.sections.vehicles')}>
              {user.vehicles.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('adminUsers.noVehicles')}</p>
              ) : (
                <ul className="divide-y rounded-xl border bg-card">
                  {user.vehicles.map((vehicle) => (
                    <li key={vehicle.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <PlateBadge value={vehicle.vehicleNumber} className="text-sm" />
                      <span className="text-sm text-muted-foreground">
                        {t(`vehicleTypes.${vehicle.vehicleType}`)}
                        {vehicle.label && ` · ${vehicle.label}`}
                      </span>
                      {vehicle.isPrimary && (
                        <StatusBadge tone="info">{t('user.vehicles.primary')}</StatusBadge>
                      )}
                      {vehicle.activeSession && (
                        <Link
                          className="ml-auto text-sm font-medium text-primary underline-offset-4 hover:underline"
                          to={adminPaths.session(vehicle.activeSession.sessionNumber)}
                        >
                          {vehicle.activeSession.blockName} ·{' '}
                          <span translate="no">{vehicle.activeSession.slotCode}</span> ·{' '}
                          {formatHour(vehicle.activeSession.entryHour)}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section id="user-current" title={t('adminUsers.sections.currentParking')}>
              {user.currentParking ? (
                <Link
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  to={adminPaths.session(user.currentParking.sessionNumber)}
                >
                  {user.currentParking.blockName} ·{' '}
                  <span translate="no">{user.currentParking.slotCode}</span> ·{' '}
                  <span className="font-mono" translate="no">
                    {user.currentParking.sessionNumber}
                  </span>
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">{t('adminUsers.notParked')}</p>
              )}
            </Section>

            <UserHistory userId={user.id} />
            <UserReceipts userId={user.id} />
          </>
        )}
      </div>

      <EditDialog
        user={user}
        open={dialog === 'edit'}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          query.reload();
        }}
      />
      <RejectDialog
        open={dialog === 'reject'}
        onClose={() => setDialog(null)}
        onSubmit={async (note) => {
          await adminApi.decideVerification(user.id, { decision: 'REJECT', note });
          setDialog(null);
          query.reload();
        }}
      />
      <DocumentDialog
        userId={user.id}
        document={dialog === 'document' ? document : null}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

function VerificationDate({ value }: { value: string }) {
  const format = useFormatters();
  return <>{format.dateTime(value)}</>;
}

function UserHistory({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const fetcher = useCallback(
    (signal: AbortSignal) => adminApi.userHistory(userId, { page, pageSize: 5 }, signal),
    [userId, page],
  );
  const query = useApiQuery(fetcher);
  return (
    <Section id="user-history" title={t('adminUsers.sections.history')}>
      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}
      {query.status === 'success' &&
        (query.data.total === 0 ? (
          <p className="text-sm text-muted-foreground">{t('user.history.empty')}</p>
        ) : (
          <>
            <ul className="divide-y rounded-xl border bg-card px-2">
              {query.data.items.map((item) => (
                <li key={item.sessionNumber}>
                  <SessionRow item={item} to={adminPaths.session(item.sessionNumber)} />
                </li>
              ))}
            </ul>
            <Pager
              page={query.data.page}
              pageSize={query.data.pageSize}
              total={query.data.total}
              onPage={setPage}
            />
          </>
        ))}
    </Section>
  );
}

function UserReceipts({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const [page, setPage] = useState(1);
  const fetcher = useCallback(
    (signal: AbortSignal) => adminApi.userReceipts(userId, { page, pageSize: 5 }, signal),
    [userId, page],
  );
  const query = useApiQuery(fetcher);
  return (
    <Section id="user-receipts" title={t('adminUsers.sections.receipts')}>
      {query.status === 'loading' && <LoadingState />}
      {query.status === 'error' && (
        <ErrorState description={errorMessage(t, query.error)} onRetry={query.refetch} />
      )}
      {query.status === 'success' &&
        (query.data.total === 0 ? (
          <p className="text-sm text-muted-foreground">{t('user.receipts.empty')}</p>
        ) : (
          <>
            <ul className="divide-y rounded-xl border bg-card">
              {query.data.items.map((receipt) => (
                <li
                  key={receipt.receiptNumber}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <Link
                    className="font-mono text-sm font-medium text-primary underline-offset-4 hover:underline"
                    to={adminPaths.receipt(receipt.receiptNumber)}
                  >
                    {receipt.receiptNumber}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    <PlateBadgeText value={receipt.vehicleNumber} /> ·{' '}
                    {format.date(receipt.issuedAt)}
                  </span>
                  <span className="ml-auto text-sm font-semibold tabular-nums">
                    {format.paise(receipt.totalPaise)}
                  </span>
                </li>
              ))}
            </ul>
            <Pager
              page={query.data.page}
              pageSize={query.data.pageSize}
              total={query.data.total}
              onPage={setPage}
            />
          </>
        ))}
    </Section>
  );
}

const PlateBadgeText = ({ value }: { value: string }) => (
  <span className="font-mono" translate="no">
    {value}
  </span>
);

const editSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
});
type EditValues = z.input<typeof editSchema>;

function EditDialog({
  user,
  open,
  onClose,
  onSaved,
}: {
  user: UserDetail;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const profile = user.parkingUser;
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    values: {
      fullName: user.fullName,
      ...(profile ? { email: profile.email, phone: profile.phone } : {}),
    },
  });

  const onSubmit = async (values: EditValues) => {
    setSubmitError(null);
    try {
      await adminApi.updateUser(user.id, profile ? values : { fullName: values.fullName });
      onSaved();
    } catch (error) {
      setSubmitError(error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('adminUsers.editTitle')}</DialogTitle>
          <DialogDescription>{t('adminUsers.editHint')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
            {submitError !== null && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden />
                <AlertDescription>{errorMessage(t, submitError)}</AlertDescription>
              </Alert>
            )}
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('userAuth.register.fullName')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {profile && (
              <>
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('userAuth.email')}</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('userAuth.register.phone')}</FormLabel>
                      <FormControl>
                        <Input type="tel" {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <LoaderCircle className="animate-spin" aria-hidden />
                )}
                {t('user.vehicles.save')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('adminUsers.rejectTitle')}</DialogTitle>
          <DialogDescription>{t('adminUsers.rejectHint')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!note.trim()) {
              setError('required');
              return;
            }
            setError(null);
            setSubmitting(true);
            onSubmit(note.trim())
              .then(() => setNote(''))
              .catch((failure: unknown) => setError(failure))
              .finally(() => setSubmitting(false));
          }}
        >
          {error !== null && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>
                {error === 'required'
                  ? t('validation.rejectionNoteRequired')
                  : errorMessage(t, error)}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <Label htmlFor="reject-note">{t('adminUsers.rejectionReason')}</Label>
            <textarea
              id="reject-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              rows={3}
              className="min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={submitting}>
              {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
              {t('adminUsers.reject')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Fetches the document with the administrator's token and shows it from a temporary blob URL. */
function DocumentDialog({
  userId,
  document,
  onClose,
}: {
  userId: string;
  document: IdentityDocumentInfo | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={document !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('adminUsers.documentTitle')}</DialogTitle>
          <DialogDescription>{document?.fileName}</DialogDescription>
        </DialogHeader>
        {/* Keyed so every document starts in the loading state. */}
        {document && <DocumentBody key={document.id} userId={userId} document={document} />}
      </DialogContent>
    </Dialog>
  );
}

function DocumentBody({ userId, document }: { userId: string; document: IdentityDocumentInfo }) {
  const { t } = useTranslation();
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; url: string }
  >({ status: 'loading' });

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    adminApi
      .identityDocument(userId, document.id)
      .then(({ blob }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', url: objectUrl });
      })
      .catch((error: unknown) => !cancelled && setState({ status: 'error', error }));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [userId, document.id]);

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') return <ErrorState description={errorMessage(t, state.error)} />;
  return (
    <>
      <div className="max-h-[70dvh] overflow-auto rounded-lg border bg-muted/30">
        {document.mimeType === 'application/pdf' ? (
          <object data={state.url} type="application/pdf" className="h-[65dvh] w-full">
            <a
              className="block p-4 text-sm text-primary underline"
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('adminUsers.openDocument')}
            </a>
          </object>
        ) : (
          <img
            src={state.url}
            alt={t('adminUsers.documentTitle')}
            className="mx-auto h-auto max-w-full"
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('adminUsers.documentPrivacy')}</p>
    </>
  );
}
