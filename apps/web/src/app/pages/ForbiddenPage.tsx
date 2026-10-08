import { ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/use-document-title';

export function ForbiddenPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('pages.forbiddenTitle'));
  return (
    <EmptyState
      icon={ShieldX}
      title={t('pages.forbiddenTitle')}
      description={t('pages.forbiddenDescription')}
      action={
        <Button asChild>
          <Link to="/">{t('common.goHome')}</Link>
        </Button>
      }
    />
  );
}
