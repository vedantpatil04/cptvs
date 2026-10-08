import { MapPinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/use-auth';
import { useDocumentTitle } from '@/hooks/use-document-title';

import { PATHS, ROLE_HOME } from '../paths';

/**
 * Unknown page. Inside the signed-in app it links back to the dashboard; on
 * public pages it links back to the public home page.
 */
export function NotFoundPage({ area }: { area: 'app' | 'public' }) {
  const { t } = useTranslation();
  const { state } = useAuth();
  useDocumentTitle(t('pages.notFoundTitle'));

  const toDashboard = area === 'app' && state.status === 'authenticated';
  const target = toDashboard ? ROLE_HOME[state.user.role] : PATHS.home;

  const content = (
    <EmptyState
      icon={MapPinOff}
      title={t('pages.notFoundTitle')}
      description={t('pages.notFoundDescription')}
      action={
        <Button asChild>
          <Link to={target}>{toDashboard ? t('common.goHome') : t('common.backToHome')}</Link>
        </Button>
      }
    />
  );

  return area === 'public' ? (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">{content}</div>
  ) : (
    content
  );
}
