import type { ReactNode } from 'react';

import { H1, Lead } from '@/components/ui/typography';
import { useDocumentTitle } from '@/hooks/use-document-title';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Primary page actions, aligned right on wide screens. */
  actions?: ReactNode;
}

/** Standard page heading. Also sets the browser tab title. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  useDocumentTitle(title);
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <H1>{title}</H1>
        {description && <Lead>{description}</Lead>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
