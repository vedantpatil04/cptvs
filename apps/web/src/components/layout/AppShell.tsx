import { Menu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';

import { BrandMark } from '@/components/branding/BrandMark';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { branding } from '@/config/branding';
import { useAuth, useCurrentUser } from '@/features/auth/use-auth';

import { NotificationBell } from '@/components/notifications/NotificationBell';
import { LanguageSwitcher } from './LanguageSwitcher';
import { PortalBottomNav, PortalTopNav } from './PortalNav';
import { SidebarNav } from './SidebarNav';
import { UserMenu } from './UserMenu';

/**
 * Authenticated application frame: fixed sidebar on large screens, slide-out
 * drawer on phones/tablets (and the Android WebView), sticky header and the
 * routed page in the main content area.
 */
export function AppShell() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const { refreshUser } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Sync authenticated user verification state on route changes
  const prevPathRef = useRef(location.pathname);
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = location.pathname;

    if (user.role === 'PARKING_USER') {
      // Re-verify if currently not verified or returning from Profile
      if (user.parkingUser?.verificationStatus !== 'VERIFIED' || prev === '/portal/profile') {
        void refreshUser();
      }
    }
  }, [location.pathname, user.role, user.parkingUser?.verificationStatus, refreshUser]);

  // Keep unverified portal sessions updated on tab focus, visibility change, and interval
  useEffect(() => {
    if (user.role !== 'PARKING_USER') return;
    if (user.parkingUser?.verificationStatus === 'VERIFIED') return;

    const onFocus = () => {
      void refreshUser();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshUser();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const interval = setInterval(() => {
      void refreshUser();
    }, 10_000);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(interval);
    };
  }, [user.role, user.parkingUser?.verificationStatus, refreshUser]);

  const isParkingUser = user.role === 'PARKING_USER';

  return (
    <div className={`min-h-dvh print:pl-0 ${isParkingUser ? 'pb-16 lg:pb-0' : 'lg:pl-64'}`}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:shadow"
      >
        {t('common.skipToContent')}
      </a>

      {!isParkingUser && (
        <>
          <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block print:hidden">
            <SidebarNav role={user.role} />
          </aside>

          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent
              side="left"
              closeLabel={t('common.close')}
              className="w-72 border-none p-0 text-sidebar-foreground [&>button]:text-sidebar-foreground"
            >
              <SheetTitle className="sr-only">{branding.shortName}</SheetTitle>
              <SheetDescription className="sr-only">{t('nav.mainNavigation')}</SheetDescription>
              <SidebarNav role={user.role} onNavigate={() => setDrawerOpen(false)} />
            </SheetContent>
          </Sheet>
        </>
      )}

      <header className="sticky top-0 z-20 flex h-16 print:hidden items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
        {!isParkingUser && (
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={t('nav.openMenu')}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="size-5" aria-hidden />
          </Button>
        )}
        <BrandMark variant="compact" className={isParkingUser ? '' : 'lg:hidden'} />

        {isParkingUser && <PortalTopNav />}

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <NotificationBell />
          <LanguageSwitcher />
          <UserMenu />
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-7xl px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0"
      >
        <Outlet />
      </main>

      {isParkingUser && <PortalBottomNav />}
    </div>
  );
}
