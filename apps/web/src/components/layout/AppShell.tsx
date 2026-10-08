import { Menu } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { BrandMark } from '@/components/branding/BrandMark';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { branding } from '@/config/branding';
import { useCurrentUser } from '@/features/auth/use-auth';

import { LanguageSwitcher } from './LanguageSwitcher';
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
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:pl-64">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:shadow"
      >
        {t('common.skipToContent')}
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
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

      <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label={t('nav.openMenu')}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="size-5" aria-hidden />
        </Button>
        <BrandMark variant="compact" className="lg:hidden" />
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <LanguageSwitcher />
          <UserMenu />
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-7xl px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
      >
        <Outlet />
      </main>
    </div>
  );
}
