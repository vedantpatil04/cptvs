import { userLoginRequestSchema, type UserLoginRequest } from '@cpvts/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, Eye, EyeOff, Info, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS, registerPath } from '@/app/paths';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/error-message';

import { AuthFrame } from './AuthFrame';
import { useAuth } from './use-auth';

/** Sign-in for Students and Campus Staff (e-mail + password). */
export function UserLoginPage() {
  const { t } = useTranslation();
  const { state, loginUser } = useAuth();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [showPassword, setShowPassword] = useState(false);
  const reason = state.status === 'unauthenticated' ? state.reason : null;

  const form = useForm<UserLoginRequest>({
    resolver: zodResolver(userLoginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: UserLoginRequest) => {
    setSubmitError(null);
    try {
      // On success the auth state changes and PublicOnlyRoute redirects.
      await loginUser(values);
    } catch (error) {
      setSubmitError(error);
      form.resetField('password');
    }
  };
  const submitting = form.formState.isSubmitting;

  return (
    <AuthFrame
      title={t('userAuth.signInTitle')}
      description={t('userAuth.signInDescription')}
      tagline={t('userAuth.tagline')}
      footer={
        <>
          <p>
            {t('userAuth.noAccount')}{' '}
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              to={registerPath('student')}
            >
              {t('userAuth.registerAsStudent')}
            </Link>
            {' · '}
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              to={registerPath('staff')}
            >
              {t('userAuth.registerAsStaff')}
            </Link>
          </p>
          <p>
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              to={PATHS.visitor.root}
            >
              {t('userAuth.visitorLink')}
            </Link>
            {' · '}
            <Link className="underline-offset-4 hover:underline" to={PATHS.login}>
              {t('userAuth.operationalLink')}
            </Link>
          </p>
        </>
      }
    >
      {reason && (
        <Alert variant="info">
          <Info aria-hidden />
          <AlertDescription>
            {reason === 'expired' ? t('auth.sessionExpired') : t('auth.signedOut')}
          </AlertDescription>
        </Alert>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5" noValidate>
          {submitError !== null && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{errorMessage(t, submitError)}</AlertDescription>
            </Alert>
          )}
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('userAuth.email')}</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('auth.password')}</FormLabel>
                <div className="relative">
                  <FormControl>
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      className="pr-11"
                      {...field}
                    />
                  </FormControl>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-0 right-0 text-muted-foreground"
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" size="lg" disabled={submitting} className="w-full">
            {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
            {submitting ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </form>
      </Form>
    </AuthFrame>
  );
}
