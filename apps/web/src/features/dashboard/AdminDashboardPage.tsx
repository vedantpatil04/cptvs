import { MapPinned, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS } from '@/app/paths';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/features/auth/use-auth';

import { ParkingKpis } from './ParkingKpis';
import { SystemStatusCard } from './SystemStatusCard';

export function AdminDashboardPage() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();

  return (
    <>
      <PageHeader
        title={t('dashboard.welcome', { name: user.fullName })}
        description={t('dashboard.adminDescription')}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={PATHS.admin.finder}>
                <Search aria-hidden />
                {t('nav.vehicleFinder')}
              </Link>
            </Button>
            <Button asChild>
              <Link to={PATHS.admin.live}>
                <MapPinned aria-hidden />
                {t('nav.liveParking')}
              </Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <ParkingKpis />
        <SystemStatusCard />
      </div>
    </>
  );
}
