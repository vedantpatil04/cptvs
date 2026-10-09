import {
  Clock,
  Coins,
  CreditCard,
  LogIn,
  LogOut,
  MapPinned,
  QrCode,
  Receipt,
  Search,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS } from '@/app/paths';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DescriptionItem, DescriptionList } from '@/components/ui/description-list';
import { useCurrentUser } from '@/features/auth/use-auth';
import { AlertsPanel } from '@/features/operations/AlertsPanel';
import { securityShiftApi } from '@/features/shifts/shifts-api';
import { useApiQuery } from '@/hooks/use-api-query';
import { useFormatters } from '@/hooks/use-formatters';
import type { TranslationCatalogue } from '@/i18n/resources';
import { errorMessage } from '@/lib/error-message';

import { ParkingKpis } from './ParkingKpis';

const QUICK_ACTIONS: {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  badge?: string;
}[] = [
  { to: PATHS.staff.entry, labelKey: 'nav.vehicleEntry', icon: LogIn },
  { to: PATHS.staff.exit, labelKey: 'nav.vehicleExit', icon: LogOut },
  { to: '/staff/exit?tab=scan', labelKey: 'Scan Parking QR', icon: QrCode, badge: 'Camera' },
  { to: PATHS.staff.finder, labelKey: 'nav.vehicleFinder', icon: Search },
  { to: PATHS.staff.live, labelKey: 'nav.liveParking', icon: MapPinned },
  { to: PATHS.staff.account, labelKey: 'nav.account', icon: Receipt },
];

export function StaffDashboardPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const { user, expiresAt } = useCurrentUser();

  const shiftQuery = useApiQuery(securityShiftApi.mine, { refreshIntervalMs: 15_000 });
  const [shiftActionLoading, setShiftActionLoading] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);

  const shiftData = shiftQuery.data;
  const currentShift = shiftData?.current;

  const handleCheckIn = async (shiftId?: string) => {
    setShiftActionLoading(true);
    setShiftError(null);
    try {
      await securityShiftApi.checkIn(shiftId);
      shiftQuery.reload();
    } catch (err) {
      setShiftError(errorMessage(t, err));
    } finally {
      setShiftActionLoading(false);
    }
  };

  const handleCheckOut = async () => {
    setShiftActionLoading(true);
    setShiftError(null);
    try {
      await securityShiftApi.checkOut();
      shiftQuery.reload();
    } catch (err) {
      setShiftError(errorMessage(t, err));
    } finally {
      setShiftActionLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('dashboard.welcome', { name: user.fullName })}
        description={t('dashboard.staffDescription')}
      />

      <div className="space-y-6">
        {/* Quick Actions */}
        <nav aria-label={t('dashboard.quickActions')}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {QUICK_ACTIONS.map(({ to, labelKey, icon: Icon, badge }) => (
              <li key={to}>
                <Link
                  to={to}
                  className="relative flex h-full flex-col items-center gap-2 rounded-xl border bg-card p-4 text-center font-medium shadow-sm transition-colors outline-none hover:border-primary hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {badge && (
                    <Badge variant="secondary" className="absolute top-2 right-2 text-[10px] px-1.5 py-0">
                      {badge}
                    </Badge>
                  )}
                  <Icon className="size-6 text-primary mt-1" aria-hidden />
                  <span className="text-xs">{labelKey.startsWith('nav.') ? t(labelKey as `nav.${keyof TranslationCatalogue['nav']}`) : labelKey}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Current Security Duty Shift */}
        {currentShift ? (
          <Card className="border-border shadow-xs">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="size-5 text-primary" />
                  <div>
                    <CardTitle className="text-base font-bold">
                      {currentShift.name} {currentShift.gate ? `· ${currentShift.gate}` : ''}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Assigned Shift · {currentShift.date} ({format.time(currentShift.startsAt)} – {format.time(currentShift.endsAt)})
                    </CardDescription>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge
                    variant={currentShift.onDuty ? 'default' : 'secondary'}
                    className={currentShift.onDuty ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                  >
                    {currentShift.status}
                  </Badge>

                  {currentShift.status === 'SCHEDULED' && (
                    <Button
                      size="sm"
                      onClick={() => handleCheckIn(currentShift.id)}
                      disabled={shiftActionLoading}
                      className="text-xs"
                    >
                      Check In to Duty
                    </Button>
                  )}

                  {currentShift.onDuty && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCheckOut}
                      disabled={shiftActionLoading}
                      className="text-xs"
                    >
                      Check Out from Shift
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-4">
              {shiftError && (
                <p className="text-xs text-destructive mb-3">{shiftError}</p>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-lg border bg-card">
                  <span className="text-muted-foreground flex items-center gap-1 font-medium">
                    <Coins className="size-3.5 text-amber-500" /> Expected Cash
                  </span>
                  <p className="text-base font-mono font-bold mt-1 text-foreground">
                    {format.paise(currentShift.cash.expectedCashPaise)}
                  </p>
                  <span className="text-[10px] text-muted-foreground">
                    {currentShift.cash.cashTransactions} cash payment(s)
                  </span>
                </div>

                <div className="p-3 rounded-lg border bg-card">
                  <span className="text-muted-foreground flex items-center gap-1 font-medium">
                    <CreditCard className="size-3.5 text-blue-500" /> Digital Collections
                  </span>
                  <p className="text-base font-mono font-bold mt-1 text-foreground">
                    {format.paise(currentShift.cash.digitalPaise)}
                  </p>
                  <span className="text-[10px] text-muted-foreground">
                    {currentShift.cash.digitalTransactions} simulated digital
                  </span>
                </div>

                <div className="p-3 rounded-lg border bg-card">
                  <span className="text-muted-foreground flex items-center gap-1 font-medium">
                    <Clock className="size-3.5 text-primary" /> Shift Progress
                  </span>
                  <p className="text-sm font-semibold mt-1">
                    {currentShift.checkedInAt ? `In: ${format.time(currentShift.checkedInAt)}` : 'Not checked in'}
                  </p>
                  <span className="text-[10px] text-muted-foreground">
                    {currentShift.flags.length > 0 ? currentShift.flags.join(', ') : 'Standard shift'}
                  </span>
                </div>

                <div className="p-3 rounded-lg border bg-card">
                  <span className="text-muted-foreground flex items-center gap-1 font-medium">
                    <Receipt className="size-3.5 text-emerald-500" /> Total Handover Due
                  </span>
                  <p className="text-base font-mono font-bold mt-1 text-emerald-600 dark:text-emerald-400">
                    {format.paise(currentShift.cash.expectedCashPaise)}
                  </p>
                  <span className="text-[10px] text-muted-foreground">
                    {currentShift.cashStatus}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed bg-muted/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  No active shift assigned right now. Operations run in {shiftData?.enforcement ?? 'standard'} mode.
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCheckIn()}
                disabled={shiftActionLoading}
                className="text-xs"
              >
                Self Check-In (Ad-hoc)
              </Button>
            </div>
          </Card>
        )}

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
