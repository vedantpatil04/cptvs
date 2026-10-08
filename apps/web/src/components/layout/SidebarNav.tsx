import type { UserRole } from '@cpvts/shared';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

import { NAVIGATION } from '@/app/navigation';
import { BrandMark } from '@/components/branding/BrandMark';
import { InstitutionNotice } from '@/components/branding/InstitutionNotice';
import { cn } from '@/lib/utils';

interface SidebarNavProps {
  role: UserRole;
  /** Called after a link is chosen (closes the mobile drawer). */
  onNavigate?: () => void;
}

/** Brand, role navigation and institution notice. Shared by desktop sidebar and mobile drawer. */
export function SidebarNav({ role, onNavigate }: SidebarNavProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-5 py-5">
        <BrandMark tone="inverted" />
      </div>

      <nav aria-label={t('nav.mainNavigation')} className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {NAVIGATION[role].map(({ to, labelKey, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent-foreground/60',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                  )
                }
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{t(labelKey)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <InstitutionNotice className="border-t border-sidebar-border px-5 py-4 text-sidebar-muted-foreground" />
    </div>
  );
}
