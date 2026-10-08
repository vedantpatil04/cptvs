import { useTranslation } from 'react-i18next';
import { useRouteError } from 'react-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/use-document-title';

/** Last-resort boundary for render errors anywhere in the route tree. */
export function RouteErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();
  useDocumentTitle(t('states.errorTitle'));

  if (import.meta.env.DEV) console.error(error);

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <ErrorState
        actions={<Button onClick={() => window.location.reload()}>{t('common.reloadPage')}</Button>}
      />
    </div>
  );
}
