import { LogIn, LogOut, MapPinned, Search, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS } from '@/app/paths';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DescriptionItem, DescriptionList } from '@/components/ui/description-list';
import { useCurrentUser } from '@/features/auth/use-auth';
import { AlertsPanel } from '@/features/operations/AlertsPanel';
import { useFormatters } from '@/hooks/use-formatters';
import type { TranslationCatalogue } from '@/i18n/resources';

import { ParkingKpis } from './ParkingKpis';

const QUICK_ACTIONS: {
  to: string;
  labelKey: `nav.${keyof TranslationCatalogue['nav']}`;
  icon: LucideIcon;
}[] = [
  { to: PATHS.staff.entry, labelKey: 'nav.vehicleEntry', icon: LogIn },
  { to: PATHS.staff.exit, labelKey: 'nav.vehicleExit', icon: LogOut },
  { to: PATHS.staff.finder, labelKey: 'nav.vehicleFinder', icon: Search },
  { to: PATHS.staff.live, labelKey: 'nav.liveParking', icon: MapPinned },
];

export function StaffDashboardPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const { user, expiresAt } = useCurrentUser();

  return (
    <>
      <PageHeader
        title={t('dashboard.welcome', { name: user.fullName })}
        description={t('dashboard.staffDescription')}
      />
      <div className="space-y-6">
        <nav aria-label={t('dashboard.quickActions')}>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {QUICK_ACTIONS.map(({ to, labelKey, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  className="flex h-full flex-col items-center gap-2 rounded-xl border bg-card p-5 text-center font-medium shadow-sm transition-colors outline-none hover:border-primary hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Icon className="size-7 text-primary" aria-hidden />
                  {t(labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <ParkingKpis />
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.sessionTitle')}</CardTitle>
              <CardDescription>{t('dashboard.sessionDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <DescriptionList>
                <DescriptionItem label={t('userMenu.signedInAs')}>{user.fullName}</DescriptionItem>
                <DescriptionItem label={t('account.role')}>
                  {t(`roles.${user.role}`)}
                </DescriptionItem>
                <DescriptionItem label={t('dashboard.sessionExpires')}>
                  {format.dateTime(expiresAt)}
                </DescriptionItem>
              </DescriptionList>
            </CardContent>
          </Card>
        </div>
        <AlertsPanel />
      </div>
    </>
  );
}
