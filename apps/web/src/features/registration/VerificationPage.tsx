import {
  institutionalIdSchema,
  VALIDATION_MESSAGES,
  type ParkingUserProfileView,
} from '@cpvts/shared';
import { CircleAlert, Clock, LoaderCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS } from '@/app/paths';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { DocumentUpload, type PickedDocument } from '@/components/user/DocumentUpload';
import { VerificationBadge } from '@/components/user/VerificationBadge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/use-auth';
import { userApi } from '@/features/user/user-api';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { errorMessage } from '@/lib/error-message';

/**
 * Shown in place of the parking pages while an account's identity
 * verification is pending or was rejected. Parking features unlock only when
 * an administrator approves the account.
 */
export function VerificationPage() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const profile = useApiQuery(userApi.profile);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      await refresh();
      profile.reload();
    } finally {
      setChecking(false);
    }
  };

  if (profile.status === 'loading') return <LoadingState />;
  if (profile.status === 'error') {
    return <ErrorState description={errorMessage(t, profile.error)} onRetry={profile.refetch} />;
  }
  const account = profile.data;
  const rejected = account.verification.status === 'REJECTED';
  const isStudent = account.category === 'STUDENT';

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t('verification.title')}
        description={
          isStudent ? t('verification.studentDescription') : t('verification.staffDescription')
        }
      />
      <div className="space-y-8">
        <section className="space-y-4" aria-labelledby="verification-status">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="verification-status" className="text-lg font-semibold">
              {isStudent ? t('verification.studentStatus') : t('verification.staffStatus')}
            </h2>
            <VerificationBadge status={account.verification.status} />
          </div>

          {rejected ? (
            <Alert variant="destructive">
              <ShieldAlert aria-hidden />
              <AlertDescription>
                <p>{t('verification.rejectedMessage')}</p>
                {account.verification.note && (
                  <p className="font-medium text-foreground">
                    {t('verification.reason')}: {account.verification.note}
                  </p>
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="info">
              <Clock aria-hidden />
              <AlertDescription>{t('verification.pendingMessage')}</AlertDescription>
            </Alert>
          )}

          <Facts account={account} />

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void check()} disabled={checking}>
              <RefreshCw className={checking ? 'animate-spin' : undefined} aria-hidden />
              {t('verification.checkStatus')}
            </Button>
            <Button asChild variant="ghost">
              <Link to={PATHS.user.profile}>{t('nav.profile')}</Link>
            </Button>
          </div>
        </section>

        {rejected && <ResubmitForm account={account} onDone={() => void check()} />}
      </div>
    </div>
  );
}

function Facts({ account }: { account: ParkingUserProfileView }) {
  const { t } = useTranslation();
  const format = useFormatters();
  return (
    <dl className="grid gap-x-8 gap-y-3 border-y py-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">
          {account.category === 'STUDENT'
            ? t('userAuth.register.studentId')
            : t('userAuth.register.staffId')}
        </dt>
        <dd className="font-mono font-medium" translate="no">
          {account.institutionalId}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('verification.submitted')}</dt>
        <dd className="font-medium">{format.dateTime(account.verification.submittedAt)}</dd>
      </div>
    </dl>
  );
}

function ResubmitForm({
  account,
  onDone,
}: {
  account: ParkingUserProfileView;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [institutionalId, setInstitutionalId] = useState(account.institutionalId);
  const [confirmId, setConfirmId] = useState('');
  const [picked, setPicked] = useState<PickedDocument | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [idError, setIdError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    const id = institutionalIdSchema.safeParse(institutionalId);
    const confirmed = institutionalIdSchema.safeParse(confirmId);
    if (!id.success) return setIdError(id.error.issues[0]?.message ?? VALIDATION_MESSAGES.required);
    if (!confirmed.success || confirmed.data !== id.data) {
      return setIdError(VALIDATION_MESSAGES.institutionalIdMismatch);
    }
    setIdError(null);
    if (!picked) return setDocumentError(VALIDATION_MESSAGES.documentRequired);

    setSubmitting(true);
    try {
      await userApi.resubmitVerification({
        institutionalId: id.data,
        confirmInstitutionalId: confirmed.data,
        document: picked.document,
      });
      onDone();
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5" noValidate>
      <h2 className="text-lg font-semibold">{t('verification.resubmitTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('verification.resubmitDescription')}</p>
      {submitError !== null && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{errorMessage(t, submitError)}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-2">
        <Label htmlFor="resubmit-id">
          {account.category === 'STUDENT'
            ? t('userAuth.register.studentId')
            : t('userAuth.register.staffId')}
        </Label>
        <Input
          id="resubmit-id"
          value={institutionalId}
          onChange={(event) => setInstitutionalId(event.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          className="uppercase placeholder:normal-case"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="resubmit-confirm">
          {t('userAuth.register.confirmId', {
            label:
              account.category === 'STUDENT'
                ? t('userAuth.register.studentId')
                : t('userAuth.register.staffId'),
          })}
        </Label>
        <Input
          id="resubmit-confirm"
          value={confirmId}
          onChange={(event) => setConfirmId(event.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          className="uppercase placeholder:normal-case"
          aria-invalid={idError !== null}
        />
        {idError && (
          <p role="alert" className="text-sm text-destructive">
            {t(idError as never)}
          </p>
        )}
      </div>
      <DocumentUpload
        value={picked}
        onChange={setPicked}
        error={documentError}
        onError={setDocumentError}
      />
      <Button type="submit" size="lg" disabled={submitting}>
        {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
        {t('verification.resubmit')}
      </Button>
    </form>
  );
}
