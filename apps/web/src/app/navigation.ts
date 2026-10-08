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
  Car,
  CircleParking,
  Ellipsis,
  House,
  Receipt,
  UserRound,
  Users,
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
    { to: PATHS.admin.users, labelKey: 'nav.users', icon: Users },
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
  // Parking users have their own light navigation (see USER_NAVIGATION); the
  // operational sidebar is never shown to them.
  PARKING_USER: [],
};

export interface UserNavItem extends NavItem {
  /** Shown in the bottom bar on phones (the rest live under "More"). */
  mobile: boolean;
}

/** Desktop: Home, My Parking, My Vehicles, Parking, History, Receipts, Profile. */
export const USER_NAVIGATION: UserNavItem[] = [
  { to: PATHS.user.root, labelKey: 'nav.home', icon: House, end: true, mobile: true },
  { to: PATHS.user.myParking, labelKey: 'nav.myParking', icon: CircleParking, mobile: false },
  { to: PATHS.user.vehicles, labelKey: 'nav.myVehicles', icon: Car, mobile: false },
  { to: PATHS.user.availability, labelKey: 'nav.parking', icon: MapPinned, mobile: true },
  { to: PATHS.user.history, labelKey: 'nav.history', icon: History, mobile: true },
  { to: PATHS.user.receipts, labelKey: 'nav.receipts', icon: Receipt, mobile: true },
  { to: PATHS.user.profile, labelKey: 'nav.profile', icon: UserRound, mobile: false },
];

/** The phone-only "More" tab. */
export const USER_MORE: Pick<UserNavItem, 'to' | 'labelKey' | 'icon'> = {
  to: PATHS.user.more,
  labelKey: 'nav.more',
  icon: Ellipsis,
};
