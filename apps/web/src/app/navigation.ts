import type { UserRole } from '@cpvts/shared';
import {
  ChartColumn,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPinned,
  ScrollText,
  Search,
  ShieldCheck,
  SquareParking,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import type { TranslationCatalogue } from '@/i18n/resources';

import { PATHS } from './paths';

export interface NavItem {
  to: string;
  labelKey: `nav.${keyof TranslationCatalogue['nav']}`;
  icon: LucideIcon;
  /** Match the path exactly (for section index routes). */
  end?: boolean;
}

/**
 * Sidebar navigation per role (Master Blueprint §39). Only real, working
 * pages are listed; later modules add their entries when they ship.
 */
export const NAVIGATION: Record<UserRole, NavItem[]> = {
  ADMIN: [
    { to: PATHS.admin.root, labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
    { to: PATHS.admin.live, labelKey: 'nav.liveParking', icon: MapPinned },
    { to: PATHS.admin.finder, labelKey: 'nav.vehicleFinder', icon: Search },
    { to: PATHS.admin.slots, labelKey: 'nav.slotManagement', icon: SquareParking },
    { to: PATHS.admin.history, labelKey: 'nav.history', icon: History },
    { to: PATHS.admin.analytics, labelKey: 'nav.analytics', icon: ChartColumn },
    { to: PATHS.admin.reports, labelKey: 'nav.reports', icon: FileSpreadsheet },
    { to: PATHS.admin.integrity, labelKey: 'nav.integrity', icon: ShieldCheck },
    { to: PATHS.admin.auditLogs, labelKey: 'nav.auditLogs', icon: ScrollText },
    { to: PATHS.admin.account, labelKey: 'nav.account', icon: UserRound },
  ],
  SECURITY_STAFF: [
    { to: PATHS.staff.root, labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
    { to: PATHS.staff.entry, labelKey: 'nav.vehicleEntry', icon: LogIn },
    { to: PATHS.staff.exit, labelKey: 'nav.vehicleExit', icon: LogOut },
    { to: PATHS.staff.finder, labelKey: 'nav.vehicleFinder', icon: Search },
    { to: PATHS.staff.live, labelKey: 'nav.liveParking', icon: MapPinned },
    { to: PATHS.staff.account, labelKey: 'nav.account', icon: UserRound },
  ],
  /** Added with the Student / Campus Staff screens. */
  PARKING_USER: [],
};
