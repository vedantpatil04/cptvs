import { isLocale } from '@cpvts/shared';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router';

import { USER_MORE, USER_NAVIGATION, type NavItem } from '@/app/navigation';
import { PATHS } from '@/app/paths';
import { BrandMark } from '@/components/branding/BrandMark';
import { InstitutionNotice } from '@/components/branding/InstitutionNotice';
import { useCurrentUser } from '@/features/auth/use-auth';
import { userApi } from '@/features/user/user-api';
import i18n from '@/i18n';
import { cn } from '@/lib/utils';

import { LanguageSwitcher } from './LanguageSwitcher';
import { UserMenu } from './UserMenu';

const MOBILE_ITEMS: Pick<NavItem, 'to' | 'labelKey' | 'icon' | 'end'>[] = [
  ...USER_NAVIGATION.filter((item) => item.mobile),
  USER_MORE,
];

/** Routes that live under the phone-only "More" tab. */
const MORE_PATHS = [PATHS.user.more, PATHS.user.vehicles, PATHS.user.myParking, PATHS.user.profile];

/**
 * Frame for Students and Campus Staff: a slim top bar with simple navigation
 * on wide screens and a bottom tab bar on phones, tablets and the Android
 * WebView. Deliberately not the operational sidebar.
 */
export function UserShell() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  useAccountLanguage();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:shadow"
      >
        {t('common.skipToContent')}
      </a>

      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 print:hidden">
        <div className="pt-safe mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link
            to={PATHS.user.root}
            className="shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark variant="compact" />
          </Link>
          <nav aria-label={t('nav.mainNavigation')} className="ml-4 hidden lg:block">
            <ul className="flex items-center gap-1">
              {USER_NAVIGATION.map(({ to, labelKey, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        'relative rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isActive
                          ? 'text-primary after:absolute after:inset-x-3 after:-bottom-[1.05rem] after:h-0.5 after:rounded-full after:bg-primary'
                          : 'text-muted-foreground hover:text-foreground',
                      )
                    }
                  >
                    {t(labelKey)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher />
            <UserMenu />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 outline-none sm:px-6 lg:pt-8 lg:pb-12 print:max-w-none print:p-0"
      >
        <Outlet />
        <InstitutionNotice className="mt-12 border-t pt-6 text-muted-foreground print:hidden" />
      </main>

      <nav
        aria-label={t('nav.mainNavigation')}
        className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t bg-background lg:hidden print:hidden"
      >
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {MOBILE_ITEMS.map(({ to, labelKey, icon: Icon, end }) => {
            const isMore = to === PATHS.user.more;
            const moreActive = isMore && MORE_PATHS.some((path) => pathname.startsWith(path));
            return (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[0.7rem] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      isActive || moreActive ? 'text-primary' : 'text-muted-foreground',
                    )
                  }
                >
                  <Icon className="size-5" aria-hidden />
                  <span className="max-w-full truncate">{t(labelKey)}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/**
 * Applies the language saved on the account once per sign-in (the user can
 * still switch at any time; the Profile page saves a new preference).
 */
function useAccountLanguage() {
  const { user, expiresAt } = useCurrentUser();
  useEffect(() => {
    // One flag per sign-in (the token expiry is unique to it), so signing in again re-applies it.
    const flag = `cpvts.localeApplied.${user.id}.${expiresAt}`;
    try {
      if (sessionStorage.getItem(flag)) return;
    } catch {
      return;
    }
    const controller = new AbortController();
    userApi
      .profile(controller.signal)
      .then((profile) => {
        try {
          sessionStorage.setItem(flag, '1');
        } catch {
          // Without storage the preference is simply re-applied on the next load.
        }
        if (isLocale(profile.preferredLocale) && profile.preferredLocale !== i18n.language) {
          void i18n.changeLanguage(profile.preferredLocale);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [user.id, expiresAt]);
}
