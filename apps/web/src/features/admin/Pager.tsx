import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { useFormatters } from '@/hooks/use-formatters';

interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}

/** "Showing 26–50 of 120" with previous / next buttons. */
export function Pager({ page, pageSize, total, onPage }: PagerProps) {
  const { t } = useTranslation();
  const format = useFormatters();
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label={t('pager.label')}
      className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm"
    >
      <p className="text-muted-foreground" aria-live="polite">
        {t('pager.showing', {
          first: format.number(first),
          last: format.number(last),
          total: format.number(total),
        })}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft aria-hidden />
          {t('pager.previous')}
        </Button>
        <span className="tabular-nums">{t('pager.page', { page, pages })}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          {t('pager.next')}
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
