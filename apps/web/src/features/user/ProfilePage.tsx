import { fullNameSchema, isLocale, phoneSchema, type ParkingUserProfileView } from '@cpvts/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, CircleAlert, LoaderCircle, LogOut, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';

import { PATHS } from '@/app/paths';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { SignOutDialog } from '@/components/layout/SignOutDialog';
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
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import { LANGUAGES } from '@/i18n/languages';
import { errorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';

import { userApi } from './user-api';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid gap-1 py-3.5 sm:grid-cols-[12rem_1fr] sm:gap-4">
    <dt className="text-sm text-muted-foreground">{label}</dt>
    <dd className="min-w-0 text-sm font-medium break-words">{children}</dd>
  </div>
);

/** Profile: account facts, verification, language and sign-out. */
export function ProfilePage() {
  const { t } = useTranslation();
  const profile = useApiQuery(userApi.profile);
  const [editing, setEditing] = useState(false);
  const [signOut, setSignOut] = useState(false);

  return (
    <>
      <PageHeader title={t('user.profile.title')} description={t('user.profile.description')} />
      {profile.status === 'loading' && <LoadingState />}
      {profile.status === 'error' && (
        <ErrorState description={errorMessage(t, profile.error)} onRetry={profile.refetch} />
      )}
      {profile.status === 'success' && (
        <div className="max-w-3xl space-y-10">
          <ProfileDetails account={profile.data} onEdit={() => setEditing(true)} />
          <LanguageChoice current={profile.data.preferredLocale} onSaved={profile.reload} />
          <div>
            <Button variant="outline" onClick={() => setSignOut(true)}>
              <LogOut aria-hidden />
              {t('auth.signOut')}
            </Button>
          </div>
          <EditDialog
            account={profile.data}
            open={editing}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              profile.reload();
            }}
          />
        </div>
      )}
      <SignOutDialog open={signOut} onOpenChange={setSignOut} />
    </>
  );
}

function ProfileDetails({
  account,
  onEdit,
}: {
  account: ParkingUserProfileView;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormatters();
  const isStudent = account.category === 'STUDENT';
  return (
    <section aria-labelledby="profile-account" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="profile-account"
          className="text-xs font-semibold tracking-widest text-muted-foreground uppercase"
        >
          {t('user.profile.account')}
        </h2>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil aria-hidden />
          {t('user.profile.edit')}
        </Button>
      </div>
      <dl className="divide-y border-y">
        <Row label={t('userAuth.register.fullName')}>{account.fullName}</Row>
        <Row label={t('userAuth.email')}>{account.email}</Row>
        <Row label={t('userAuth.register.phone')}>{account.phone}</Row>
        <Row label={t('user.profile.category')}>
          {isStudent ? t('user.profile.categoryStudent') : t('user.profile.categoryStaff')}
        </Row>
        <Row label={isStudent ? t('userAuth.register.studentId') : t('userAuth.register.staffId')}>
          <span className="font-mono" translate="no">
            {account.institutionalId}
          </span>
        </Row>
        <Row label={isStudent ? t('verification.studentStatus') : t('verification.staffStatus')}>
          <div className="space-y-1.5">
            <VerificationBadge status={account.verification.status} />
            {account.verification.note && (
              <p className="text-muted-foreground">
                {t('verification.reason')}: {account.verification.note}
              </p>
            )}
            {account.verification.status !== 'VERIFIED' && (
              <p>
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  to={PATHS.user.root}
                >
                  {t('user.profile.viewVerification')}
                </Link>
              </p>
            )}
          </div>
        </Row>
        <Row label={t('user.profile.vehicles')}>
          <Link
            className="text-primary underline-offset-4 hover:underline"
            to={PATHS.user.vehicles}
          >
            {t('user.profile.vehicleCount', { count: account.vehicleCount })}
          </Link>
        </Row>
        <Row label={t('user.profile.memberSince')}>{format.date(account.memberSince)}</Row>
      </dl>
    </section>
  );
}

/** Saves the language as the account preference and switches the app to it at once. */
export function LanguageChoice({
  current,
  onSaved,
}: {
  current: string | null;
  onSaved?: () => void;
}) {
  const { t, i18n: active } = useTranslation();
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const choose = async (code: string) => {
    setError(null);
    setSaving(code);
    try {
      await i18n.changeLanguage(code);
      await userApi.updateProfile({ preferredLocale: isLocale(code) ? code : null });
      onSaved?.();
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(null);
    }
  };

  return (
    <section aria-labelledby="profile-language" className="space-y-3">
      <h2
        id="profile-language"
        className="text-xs font-semibold tracking-widest text-muted-foreground uppercase"
      >
        {t('user.profile.language')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('user.profile.languageHint')}</p>
      {error !== null && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{errorMessage(t, error)}</AlertDescription>
        </Alert>
      )}
      <div
        role="radiogroup"
        aria-label={t('language.label')}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {LANGUAGES.map((language) => {
          const selected = active.language === language.code;
          return (
            <button
              key={language.code}
              type="button"
              role="radio"
              aria-checked={selected}
              lang={language.code}
              disabled={saving !== null}
              onClick={() => void choose(language.code)}
              className={cn(
                'flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-accent',
              )}
            >
              {saving === language.code ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                selected && <Check className="size-4" aria-hidden />
              )}
              {language.nativeName}
            </button>
          );
        })}
      </div>
      {current && current !== active.language && (
        <p className="text-xs text-muted-foreground">{t('user.profile.languageDiffers')}</p>
      )}
    </section>
  );
}

const editSchema = z.object({ fullName: fullNameSchema, phone: phoneSchema });
type EditValues = z.input<typeof editSchema>;

function EditDialog({
  account,
  open,
  onClose,
  onSaved,
}: {
  account: ParkingUserProfileView;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    values: { fullName: account.fullName, phone: account.phone },
  });

  const onSubmit = async (values: EditValues) => {
    setSubmitError(null);
    try {
      await userApi.updateProfile(values);
      onSaved();
    } catch (error) {
      setSubmitError(error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('user.profile.editTitle')}</DialogTitle>
          <DialogDescription>{t('user.profile.editHint')}</DialogDescription>
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
                    <Input autoComplete="name" {...field} />
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
                    <Input type="tel" inputMode="tel" autoComplete="tel" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
