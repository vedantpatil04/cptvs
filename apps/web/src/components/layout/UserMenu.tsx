import { LogOut, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { NAVIGATION } from '@/app/navigation';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCurrentUser } from '@/features/auth/use-auth';

import { SignOutDialog } from './SignOutDialog';

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

export function UserMenu() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const accountPath = NAVIGATION[user.role].find((item) => item.labelKey === 'nav.account')?.to;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-10 gap-2 px-2" aria-label={t('userMenu.open')}>
            <Avatar>
              <AvatarFallback>{initials(user.fullName)}</AvatarFallback>
            </Avatar>
            <span className="hidden max-w-40 flex-col items-start leading-tight md:flex">
              <span className="truncate text-sm font-medium">{user.fullName}</span>
              <span className="truncate text-xs text-muted-foreground">
                {t(`roles.${user.role}`)}
              </span>
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <p className="text-xs text-muted-foreground">{t('userMenu.signedInAs')}</p>
            <p className="truncate font-medium">{user.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {user.role === 'PARKING_USER' ? (
              <DropdownMenuItem asChild>
                <Link to="/portal/profile">
                  <UserRound aria-hidden />
                  {t('nav.profile')}
                </Link>
              </DropdownMenuItem>
            ) : accountPath ? (
              <DropdownMenuItem asChild>
                <Link to={accountPath}>
                  <UserRound aria-hidden />
                  {t('nav.account')}
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild>
              <Link to="/help">
                <span className="size-4 flex items-center justify-center font-bold text-xs border rounded-full">?</span>
                {t('nav.help')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setSignOutOpen(true)}>
              <LogOut aria-hidden />
              {t('auth.signOut')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
    </>
  );
}
