import type { UserRole } from '@cpvts/shared';
import { LayoutDashboard, UserRound, type LucideIcon } from 'lucide-react';

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
 * Sidebar navigation per role. Add an entry here when a module ships —
 * only real, working pages are listed.
 */
export const NAVIGATION: Record<UserRole, NavItem[]> = {
  ADMIN: [
    { to: PATHS.admin.root, labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
    { to: PATHS.admin.account, labelKey: 'nav.account', icon: UserRound },
  ],
  SECURITY_STAFF: [
    { to: PATHS.staff.root, labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
    { to: PATHS.staff.account, labelKey: 'nav.account', icon: UserRound },
  ],
};
