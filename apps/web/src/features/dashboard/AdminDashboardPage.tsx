import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/layout/PageHeader';
import { useCurrentUser } from '@/features/auth/use-auth';

import { ParkingNotConfigured } from './ParkingNotConfigured';
import { SystemStatusCard } from './SystemStatusCard';

export function AdminDashboardPage() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();

  return (
    <>
      <PageHeader
        title={t('dashboard.welcome', { name: user.fullName })}
        description={t('dashboard.adminDescription')}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <ParkingNotConfigured />
        <SystemStatusCard />
      </div>
    </>
  );
}
