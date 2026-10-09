import { CircleHelp, LayoutDashboard, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';

import { PATHS, ROLE_HOME } from '@/app/paths';
import { BrandMark } from '@/components/branding/BrandMark';
import { InstitutionNotice } from '@/components/branding/InstitutionNotice';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/use-auth';

/**
 * Frame for public pages (no sign-in required): brand, Help/FAQ, language
 * selector and a clear entry point for Admin/Staff sign-in.
 */
export function PublicLayout() {
  const { t } = useTranslation();
  const { state } = useAuth();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:shadow"
      >
        {t('common.skipToContent')}
      </a>

      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link
            to={PATHS.home}
            className="min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark variant="compact" />
          </Link>
          <nav
            aria-label={t('nav.mainNavigation')}
            className="ml-auto flex items-center gap-1 sm:gap-2"
          >
            <Button asChild variant="ghost" size="sm" aria-label={t('nav.help')}>
              <Link to={PATHS.help}>
                <CircleHelp aria-hidden />
                <span className="hidden md:inline">{t('nav.help')}</span>
              </Link>
            </Button>
            <LanguageSwitcher />
            {state.status === 'authenticated' ? (
              <Button asChild size="sm">
                <Link to={ROLE_HOME[state.user.role]}>
                  <LayoutDashboard aria-hidden />
                  <span className="hidden sm:inline">{t('public.dashboardButton')}</span>
                </Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link to={PATHS.login}>
                  <LogIn aria-hidden />
                  <span className="sm:hidden">{t('public.loginShort')}</span>
                  <span className="hidden sm:inline">{t('public.loginButton')}</span>
                </Link>
              </Button>
            )}
          </nav>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>

      <footer className="bg-sidebar text-sidebar-muted-foreground">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          <InstitutionNotice />
        </div>
      </footer>
    </div>
  );
}
