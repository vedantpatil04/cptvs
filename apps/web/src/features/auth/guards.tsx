import type { UserRole } from '@cpvts/shared';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';

import { ForbiddenPage } from '@/app/pages/ForbiddenPage';
import { PATHS, ROLE_HOME } from '@/app/paths';
import { ErrorState } from '@/components/feedback/ErrorState';
import { FullPageLoader } from '@/components/feedback/LoadingState';
import { VerificationPage } from '@/features/registration/VerificationPage';

import { useAuth } from './use-auth';

export interface LoginLocationState {
  from?: string;
}

/** Where to go after sign-in: the originally requested page if it is in the user's own area. */
const postLoginPath = (role: UserRole, state: unknown): string => {
  const home = ROLE_HOME[role];
  const from = (state as LoginLocationState | null)?.from;
  return from && (from === home || from.startsWith(`${home}/`)) ? from : home;
};

/** Renders child routes only for a verified, signed-in user. */
export function RequireAuth() {
  const { t } = useTranslation();
  const { state, retry } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <FullPageLoader label={t('auth.restoringSession')} />;

  if (state.status === 'error') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <ErrorState
          title={t('auth.sessionCheckFailed')}
          description={t('errors.network')}
          onRetry={retry}
        />
      </div>
    );
  }

  if (state.status === 'unauthenticated') {
    const from: LoginLocationState = { from: `${location.pathname}${location.search}` };
    // Students and Campus Staff have their own sign-in door.
    const door =
      location.pathname.startsWith(`${PATHS.user.root}/`) || location.pathname === PATHS.user.root
        ? PATHS.userLogin
        : PATHS.login;
    return <Navigate to={door} replace state={from} />;
  }

  return <Outlet />;
}

/**
 * Restricts child routes to one role. The API enforces the same rule; this
 * guard only keeps the UI honest about what the user can do.
 */
export function RequireRole({ role }: { role: UserRole }) {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;
  return state.user.role === role ? <Outlet /> : <FramelessForbidden />;
}

/** "Access denied" for a role that has no shell around the page (centred on its own). */
function FramelessForbidden() {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <ForbiddenPage />
    </div>
  );
}

/**
 * The operational frame (sidebar shell) is for Administrators and Security
 * Staff. Students and Campus Staff never see it; they have their own area.
 */
export function RequireOperational() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;
  return state.user.role === 'PARKING_USER' ? <FramelessForbidden /> : <Outlet />;
}

/**
 * For the sign-in page: once the user is signed in (including right after a
 * successful login) redirects to the page they originally requested.
 */
export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <FullPageLoader label={t('auth.restoringSession')} />;
  if (state.status === 'authenticated') {
    return <Navigate to={postLoginPath(state.user.role, location.state)} replace />;
  }
  return children;
}

/**
 * Parking pages for Students and Campus Staff are for verified accounts only.
 * Until an administrator approves the identity document the user sees the
 * verification status instead; the API refuses the same requests regardless.
 * The status is refreshed when the page opens and when the tab regains focus,
 * so an approval shows up without signing in again.
 */
export function RequireVerified() {
  const { state, refresh } = useAuth();

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  if (state.status !== 'authenticated') return null;
  return state.user.parkingUser?.verificationStatus === 'VERIFIED' ? (
    <Outlet />
  ) : (
    <VerificationPage />
  );
}
