import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DescriptionItem, DescriptionList } from '@/components/ui/description-list';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useFormatters } from '@/hooks/use-formatters';

import { ParkingNotConfigured } from './ParkingNotConfigured';

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
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <ParkingNotConfigured />
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.sessionTitle')}</CardTitle>
            <CardDescription>{t('dashboard.sessionDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <DescriptionList>
              <DescriptionItem label={t('userMenu.signedInAs')}>{user.fullName}</DescriptionItem>
              <DescriptionItem label={t('account.role')}>{t(`roles.${user.role}`)}</DescriptionItem>
              <DescriptionItem label={t('dashboard.sessionExpires')}>
                {format.dateTime(expiresAt)}
              </DescriptionItem>
            </DescriptionList>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
