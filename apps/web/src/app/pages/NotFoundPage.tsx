import { MapPinOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/use-document-title';

export function NotFoundPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('pages.notFoundTitle'));
  return (
    <EmptyState
      icon={MapPinOff}
      title={t('pages.notFoundTitle')}
      description={t('pages.notFoundDescription')}
      action={
        <Button asChild>
          <Link to="/">{t('common.goHome')}</Link>
        </Button>
      }
    />
  );
}
