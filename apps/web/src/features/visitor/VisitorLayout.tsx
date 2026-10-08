import { LogOut } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useNavigate } from 'react-router';

import { PATHS } from '@/app/paths';
import { BrandMark } from '@/components/branding/BrandMark';
import { InstitutionNotice } from '@/components/branding/InstitutionNotice';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { Button } from '@/components/ui/button';

import {
  VisitorContext,
  visitorStore,
  type VisitorContextValue,
  type VisitorSession,
  useVisitor,
} from './visitor-session';

/** Owns the visitor's session token and the lightweight visitor frame. */
export function VisitorLayout() {
  const { t } = useTranslation();
  const [session, setSession] = useState<VisitorSession | null>(() => visitorStore.read());

  const start = useCallback((next: VisitorSession) => {
    visitorStore.write(next);
    setSession(next);
  }, []);
  const end = useCallback(() => {
    visitorStore.clear();
    setSession(null);
  }, []);
  const value = useMemo<VisitorContextValue>(
    () => ({ session, start, end }),
    [session, start, end],
  );

  return (
    <VisitorContext.Provider value={value}>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:shadow"
        >
          {t('common.skipToContent')}
        </a>
        <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 print:hidden">
          <div className="pt-safe mx-auto flex h-16 w-full max-w-3xl items-center gap-2 px-4 sm:px-6">
            <Link
              to={PATHS.home}
              className="min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BrandMark variant="compact" />
            </Link>
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <LanguageSwitcher />
              {session && <ExitButton />}
            </div>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8 print:max-w-none print:p-0"
        >
          <Outlet />
        </main>
        <footer className="border-t print:hidden">
          <div className="mx-auto w-full max-w-3xl px-4 py-5 text-muted-foreground sm:px-6">
            <InstitutionNotice />
          </div>
        </footer>
      </div>
    </VisitorContext.Provider>
  );
}

function ExitButton() {
  const { t } = useTranslation();
  const { end } = useVisitor();
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        end();
        void navigate(PATHS.visitor.root);
      }}
    >
      <LogOut aria-hidden />
      <span className="hidden sm:inline">{t('visitor.exit')}</span>
    </Button>
  );
}
