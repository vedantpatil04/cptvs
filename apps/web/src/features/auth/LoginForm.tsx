import {
  loginRequestSchema,
  userLoginRequestSchema,
  type LoginRequest,
  type UserLoginRequest,
} from '@cpvts/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlert, Eye, EyeOff, GraduationCap, LoaderCircle, Shield, Ticket } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { PATHS } from '@/app/paths';
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
  const { login, userLogin } = useAuth();
  const [params] = useSearchParams();
  const initialMode = params.get('tab') === 'user' ? 'USER' : 'STAFF';
  const [mode, setMode] = useState<'STAFF' | 'USER'>(initialMode);

  const [submitError, setSubmitError] = useState<unknown>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Staff/Admin Form
  const staffForm = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { username: '', password: '' },
  });

  // Student/Campus Staff Form
  const userForm = useForm<UserLoginRequest>({
    resolver: zodResolver(userLoginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const onStaffSubmit = async (values: LoginRequest) => {
    setSubmitError(null);
    try {
      await login(values);
    } catch (error) {
      setSubmitError(error);
      staffForm.resetField('password');
    }
  };

  const onUserSubmit = async (values: UserLoginRequest) => {
    setSubmitError(null);
    try {
      await userLogin(values);
    } catch (error) {
      setSubmitError(error);
      userForm.resetField('password');
    }
  };

  const isStaffSubmitting = staffForm.formState.isSubmitting;
  const isUserSubmitting = userForm.formState.isSubmitting;

  return (
    <div className="space-y-6">
      {/* Role / Mode Switcher */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => {
            setSubmitError(null);
            setMode('STAFF');
          }}
          className={`flex items-center justify-center gap-2 rounded-md py-2 transition-colors ${
            mode === 'STAFF'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Shield className="size-4" aria-hidden />
          <span>Admin / Staff</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setSubmitError(null);
            setMode('USER');
          }}
          className={`flex items-center justify-center gap-2 rounded-md py-2 transition-colors ${
            mode === 'USER'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <GraduationCap className="size-4" aria-hidden />
          <span>Student / Staff</span>
        </button>
      </div>

      {submitError !== null && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{errorMessage(t, submitError)}</AlertDescription>
        </Alert>
      )}

      {mode === 'STAFF' ? (
        <Form {...staffForm}>
          <form onSubmit={staffForm.handleSubmit(onStaffSubmit)} className="grid gap-5" noValidate>
            <FormField
              control={staffForm.control}
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
              control={staffForm.control}
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

            <Button type="submit" size="lg" disabled={isStaffSubmitting} className="w-full">
              {isStaffSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
              {isStaffSubmitting ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </form>
        </Form>
      ) : (
        <Form {...userForm}>
          <form onSubmit={userForm.handleSubmit(onUserSubmit)} className="grid gap-5" noValidate>
            <FormField
              control={userForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="student@institution.edu"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={userForm.control}
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

            <Button type="submit" size="lg" disabled={isUserSubmitting} className="w-full">
              {isUserSubmitting && <LoaderCircle className="animate-spin" aria-hidden />}
              {isUserSubmitting ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </form>
        </Form>
      )}

      {/* Auxiliary links for Visitors and Registration */}
      <div className="space-y-3 pt-2 text-center text-xs text-muted-foreground border-t">
        <div className="pt-2">
          <span>Are you a student or campus staff member? </span>
          <Link
            to={PATHS.register.student}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Register here
          </Link>
        </div>
        <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
          <Ticket className="size-3.5" aria-hidden />
          <span>Visiting campus? </span>
          <Link
            to={PATHS.visitor.root}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Track your visitor slip
          </Link>
        </div>
      </div>
    </div>
  );
}
