import { Car, ChevronRight, CircleHelp, CircleParking, LogOut, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS } from '@/app/paths';
import { PageHeader } from '@/components/layout/PageHeader';
import { SignOutDialog } from '@/components/layout/SignOutDialog';
import { useApiQuery } from '@/hooks/use-api-query';

import { LanguageChoice } from './ProfilePage';
import { userApi } from './user-api';

const LINKS = [
  { to: PATHS.user.myParking, labelKey: 'nav.myParking', icon: CircleParking },
  { to: PATHS.user.vehicles, labelKey: 'nav.myVehicles', icon: Car },
  { to: PATHS.user.profile, labelKey: 'nav.profile', icon: UserRound },
  { to: PATHS.help, labelKey: 'nav.help', icon: CircleHelp },
] as const;

/** The phone-only "More" tab: everything that is not in the bottom bar. */
export function MorePage() {
  const { t } = useTranslation();
  const profile = useApiQuery(userApi.profile);
  const [signOut, setSignOut] = useState(false);

  return (
    <>
      <PageHeader title={t('nav.more')} />
      <div className="max-w-xl space-y-8">
        <nav aria-label={t('nav.more')}>
          <ul className="divide-y rounded-xl border bg-card">
            {LINKS.map(({ to, labelKey, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <Icon className="size-5 text-muted-foreground" aria-hidden />
                  <span className="flex-1">{t(labelKey)}</span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <LanguageChoice
          current={profile.status === 'success' ? profile.data.preferredLocale : null}
          onSaved={profile.reload}
        />
        <button
          type="button"
          onClick={() => setSignOut(true)}
          className="flex min-h-12 w-full items-center gap-3 rounded-xl border bg-card px-4 text-sm font-medium text-destructive outline-none hover:bg-destructive/5 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="size-5" aria-hidden />
          {t('auth.signOut')}
        </button>
      </div>
      <SignOutDialog open={signOut} onOpenChange={setSignOut} />
    </>
  );
}
