import { ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/use-auth';
import { useDocumentTitle } from '@/hooks/use-document-title';

import { PATHS, ROLE_HOME } from '../paths';

export function ForbiddenPage() {
  const { t } = useTranslation();
  const { state } = useAuth();
  useDocumentTitle(t('pages.forbiddenTitle'));
  const home = state.status === 'authenticated' ? ROLE_HOME[state.user.role] : PATHS.home;

  return (
    <EmptyState
      icon={ShieldX}
      title={t('pages.forbiddenTitle')}
      description={t('pages.forbiddenDescription')}
      action={
        <Button asChild>
          <Link to={home}>{t('common.goHome')}</Link>
        </Button>
      }
    />
  );
}
