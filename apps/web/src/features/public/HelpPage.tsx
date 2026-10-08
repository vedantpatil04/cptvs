import { ArrowLeft, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS } from '@/app/paths';
import { Button } from '@/components/ui/button';
import { H1, Lead } from '@/components/ui/typography';
import { useDocumentTitle } from '@/hooks/use-document-title';
import type { TranslationCatalogue } from '@/i18n/resources';

type QuestionKey = keyof TranslationCatalogue['help']['questions'];

/** Order in which questions are shown. Each key has a question and answer in every locale. */
const QUESTIONS: QuestionKey[] = [
  'availability',
  'locations',
  'fees',
  'vehicle',
  'login',
  'language',
];

/** Static, public Help & FAQ. Answers describe only what the system actually does. */
export function HelpPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('help.title'));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link to={PATHS.home}>
          <ArrowLeft aria-hidden />
          {t('common.backToHome')}
        </Link>
      </Button>
      <div className="space-y-2">
        <H1>{t('help.title')}</H1>
        <Lead>{t('help.description')}</Lead>
      </div>
      <div className="divide-y rounded-xl border bg-card">
        {QUESTIONS.map((key) => (
          <details key={key} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t(`help.questions.${key}.question`)}
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="mt-3 text-sm text-muted-foreground">
              {t(`help.questions.${key}.answer`)}
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}
