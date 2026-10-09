import type { LucideIcon } from 'lucide-react';
import {
  Car,
  History,
  LayoutDashboard,
  MapPinned,
  Receipt,
  SquareParking,
} from 'lucide-react';
import { NavLink } from 'react-router';

import { PATHS } from '@/app/paths';

export interface PortalNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const PORTAL_NAV_ITEMS: PortalNavItem[] = [
  { to: PATHS.portal.root, label: 'Home', icon: LayoutDashboard, end: true },
  { to: PATHS.portal.myParking, label: 'My Parking', icon: MapPinned },
  { to: PATHS.portal.vehicles, label: 'My Vehicles', icon: Car },
  { to: PATHS.portal.parking, label: 'Parking', icon: SquareParking },
  { to: PATHS.portal.history, label: 'History', icon: History },
  { to: PATHS.portal.receipts, label: 'Receipts', icon: Receipt },
];

/** Desktop horizontal top navigation bar for Students and Campus Staff. */
export function PortalTopNav() {
  return (
    <nav className="hidden lg:flex items-center gap-1 xl:gap-2 ml-6">
      {PORTAL_NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
            }`
          }
        >
          <Icon className="size-3.5" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Mobile bottom thumb-friendly navigation bar for Students and Campus Staff. */
export function PortalBottomNav() {
  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed bottom-0 inset-x-0 z-30 lg:hidden flex items-center justify-around border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 px-2 py-1.5 shadow-lg print:hidden"
    >
      {PORTAL_NAV_ITEMS.slice(0, 5).map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-1 py-1 px-2.5 rounded-md min-w-[56px] text-[10px] font-semibold transition-colors ${
              isActive
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`
          }
        >
          <Icon className="size-4" />
          <span className="truncate max-w-[64px]">{label}</span>
        </NavLink>
      ))}
      <NavLink
        to={PATHS.portal.receipts}
        className={({ isActive }) =>
          `flex flex-col items-center justify-center gap-1 py-1 px-2.5 rounded-md min-w-[56px] text-[10px] font-semibold transition-colors ${
            isActive
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`
        }
      >
        <Receipt className="size-4" />
        <span className="truncate max-w-[64px]">Receipts</span>
      </NavLink>
    </nav>
  );
}
