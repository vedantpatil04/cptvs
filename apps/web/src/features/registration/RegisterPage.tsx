import {
  emailSchema,
  fullNameSchema,
  institutionalIdSchema,
  passwordPolicySchema,
  phoneSchema,
  VALIDATION_MESSAGES,
  type ParkingUserCategory,
} from '@cpvts/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, CircleAlert, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { z } from 'zod';

import { NotFoundPage } from '@/app/pages/NotFoundPage';
import { PATHS, registerPath } from '@/app/paths';
import { DocumentUpload, type PickedDocument } from '@/components/user/DocumentUpload';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { AuthFrame } from '@/features/auth/AuthFrame';
import { useAuth } from '@/features/auth/use-auth';
import { errorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';

const formSchema = z
  .object({
    fullName: fullNameSchema,
    institutionalId: institutionalIdSchema,
    email: emailSchema,
    phone: phoneSchema,
    password: passwordPolicySchema,
    confirmPassword: z.string().min(1, { error: VALIDATION_MESSAGES.required }),
    /** Confirmed on step 2; checked against the ID on submit. */
    confirmInstitutionalId: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    error: VALIDATION_MESSAGES.passwordsDoNotMatch,
  });
type FormInput = z.input<typeof formSchema>;

const STEP_ONE_FIELDS = [
  'fullName',
  'institutionalId',
  'email',
  'phone',
  'password',
  'confirmPassword',
] as const;

const CATEGORIES: Record<string, ParkingUserCategory> = { student: 'STUDENT', staff: 'STAFF' };

/** Two-step Student / Campus Staff registration with ID verification upload. */
export function RegisterPage() {
  const { category: param = '' } = useParams();
  const category = CATEGORIES[param];
  if (!category) return <NotFoundPage area="public" />;
  return <RegisterForm key={category} category={category} />;
}

function RegisterForm({ category }: { category: ParkingUserCategory }) {
  const { t } = useTranslation();
  const { registerUser } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [showPassword, setShowPassword] = useState(false);
  const [picked, setPicked] = useState<PickedDocument | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const isStudent = category === 'STUDENT';

  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: '',
      institutionalId: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      confirmInstitutionalId: '',
    },
  });
  const submitting = form.formState.isSubmitting;

  const next = async () => {
    if (await form.trigger(STEP_ONE_FIELDS)) setStep(2);
  };

  const onSubmit = async (values: FormInput) => {
    setSubmitError(null);
    if (!picked) {
      setDocumentError(VALIDATION_MESSAGES.documentRequired);
      return;
    }
    const parsed = formSchema.parse(values);
    const confirmed = institutionalIdSchema.safeParse(values.confirmInstitutionalId);
    if (!confirmed.success || confirmed.data !== parsed.institutionalId) {
      form.setError('confirmInstitutionalId', {
        message: VALIDATION_MESSAGES.institutionalIdMismatch,
      });
      return;
    }
    try {
      // On success the auth state changes and PublicOnlyRoute redirects.
      await registerUser(category, {
        fullName: parsed.fullName,
        institutionalId: parsed.institutionalId,
        confirmInstitutionalId: confirmed.data,
        email: parsed.email,
        phone: parsed.phone,
        password: parsed.password,
        document: picked.document,
      });
    } catch (error) {
      setSubmitError(error);
    }
  };

  const idLabel = isStudent ? t('userAuth.register.studentId') : t('userAuth.register.staffId');

  return (
    <AuthFrame
      title={isStudent ? t('userAuth.register.studentTitle') : t('userAuth.register.staffTitle')}
      description={t('userAuth.register.description')}
      tagline={t('userAuth.tagline')}
      footer={
        <p>
          {t('userAuth.haveAccount')}{' '}
          <Link
            className="font-medium text-primary underline-offset-4 hover:underline"
            to={PATHS.userLogin}
          >
            {t('auth.signIn')}
          </Link>
        </p>
      }
    >
      <div
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
        role="group"
        aria-label={t('userAuth.register.iAm')}
      >
        {(['student', 'staff'] as const).map((value) => (
          <Link
            key={value}
            to={registerPath(value)}
            replace
            aria-current={CATEGORIES[value] === category ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-2 text-center text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
              CATEGORIES[value] === category
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`userAuth.register.${value}`)}
          </Link>
        ))}
      </div>

      <ol className="flex items-center gap-3 text-sm" aria-label={t('userAuth.register.steps')}>
        {([1, 2] as const).map((value) => (
          <li
            key={value}
            aria-current={step === value ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 font-medium',
              step === value ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'grid size-6 place-items-center rounded-full text-xs',
                step === value ? 'bg-primary text-primary-foreground' : 'bg-muted',
              )}
            >
              {value}
            </span>
            {value === 1 ? t('userAuth.register.stepDetails') : t('userAuth.register.stepIdentity')}
          </li>
        ))}
      </ol>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5" noValidate>
          {submitError !== null && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{errorMessage(t, submitError)}</AlertDescription>
            </Alert>
          )}

          <div className={cn('grid gap-5', step !== 1 && 'hidden')}>
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
              name="institutionalId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{idLabel}</FormLabel>
                  <FormControl>
                    <Input
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      className="uppercase placeholder:normal-case"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                      spellCheck={false}
                      {...field}
                    />
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
                        autoComplete="new-password"
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
                  <FormDescription>{t('userAuth.register.passwordHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('userAuth.register.confirmPassword')}</FormLabel>
                  <FormControl>
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="button" size="lg" onClick={() => void next()}>
              {t('userAuth.register.continue')}
              <ArrowRight aria-hidden />
            </Button>
          </div>

          <div className={cn('grid gap-5', step !== 2 && 'hidden')}>
            <Alert variant="info">
              <AlertDescription>
                {isStudent
                  ? t('userAuth.register.studentNotice')
                  : t('userAuth.register.staffNotice')}
              </AlertDescription>
            </Alert>
            <FormField
              control={form.control}
              name="confirmInstitutionalId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('userAuth.register.confirmId', { label: idLabel })}</FormLabel>
                  <FormControl>
                    <Input
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      className="uppercase placeholder:normal-case"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{t('userAuth.register.confirmIdHint')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DocumentUpload
              value={picked}
              onChange={setPicked}
              error={documentError}
              onError={setDocumentError}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => setStep(1)}
                disabled={submitting}
              >
                <ArrowLeft aria-hidden />
                {t('userAuth.register.back')}
              </Button>
              <Button type="submit" size="lg" disabled={submitting} className="sm:flex-1">
                {submitting && <LoaderCircle className="animate-spin" aria-hidden />}
                {submitting ? t('userAuth.register.submitting') : t('userAuth.register.submit')}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </AuthFrame>
  );
}
