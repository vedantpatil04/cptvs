import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BrandMark } from '@/components/branding/BrandMark';
import { InstitutionNotice } from '@/components/branding/InstitutionNotice';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { branding } from '@/config/branding';
import { useDocumentTitle } from '@/hooks/use-document-title';

import { LoginForm } from './LoginForm';
import { useAuth } from './use-auth';

export function LoginPage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  useDocumentTitle(t('auth.signInTitle'));

  const reason = state.status === 'unauthenticated' ? state.reason : null;

  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Brand panel */}
      <section className="flex flex-col gap-4 bg-sidebar px-6 py-6 text-sidebar-foreground sm:px-10 lg:justify-between lg:gap-8 lg:px-14 lg:py-12">
        <BrandMark tone="inverted" variant="compact" />
        <p className="text-xl leading-tight font-bold text-balance text-sidebar-accent-foreground lg:text-4xl">
          {branding.productName}
        </p>
        <InstitutionNotice className="text-sidebar-muted-foreground" />
      </section>

      {/* Sign-in panel */}
      <section className="flex flex-1 flex-col px-4 py-4 sm:px-10 sm:py-6">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <div className="flex flex-1 items-start justify-center py-4 sm:items-center sm:py-8">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-2xl">{t('auth.signInTitle')}</CardTitle>
              <CardDescription>{t('auth.signInDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              {reason && (
                <Alert variant="info">
                  <Info aria-hidden />
                  <AlertDescription>
                    {reason === 'expired' ? t('auth.sessionExpired') : t('auth.signedOut')}
                  </AlertDescription>
                </Alert>
              )}
              <LoginForm />
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
