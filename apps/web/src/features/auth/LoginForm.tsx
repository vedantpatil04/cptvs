import { loginRequestSchema, type LoginRequest } from '@cpvts/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

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

import { useAuth } from './use-auth';

export function LoginForm() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = async (values: LoginRequest) => {
    setSubmitError(null);
    try {
      // On success the auth state changes and PublicOnlyRoute redirects.
      await login(values);
    } catch (error) {
      setSubmitError(error);
      form.resetField('password');
    }
  };

  const submitting = form.formState.isSubmitting;

  return (
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
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.username')}</FormLabel>
              <FormControl>
                <Input
                  autoComplete="username"
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
  );
}
