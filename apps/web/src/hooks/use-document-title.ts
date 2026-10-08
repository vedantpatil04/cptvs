import { useEffect } from 'react';

import { branding } from '@/config/branding';

/** Sets the browser tab title to "<page> · <short brand name>". */
export const useDocumentTitle = (pageTitle?: string): void => {
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} · ${branding.shortName}` : branding.shortName;
  }, [pageTitle]);
};
