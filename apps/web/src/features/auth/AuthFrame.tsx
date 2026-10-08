import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { PATHS } from '@/app/paths';
import { BrandMark } from '@/components/branding/BrandMark';
import { InstitutionNotice } from '@/components/branding/InstitutionNotice';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { branding } from '@/config/branding';
import { useDocumentTitle } from '@/hooks/use-document-title';

interface AuthFrameProps {
  title: string;
  description?: string;
  /** Short line under the product name in the brand panel. */
  tagline: string;
  children: ReactNode;
  /** Links shown under the form (switch sign-in / register / visitor). */
  footer?: ReactNode;
}

/** Two-panel frame shared by the Student / Staff sign-in and registration pages. */
export function AuthFrame({ title, description, tagline, children, footer }: AuthFrameProps) {
  const { t } = useTranslation();
  useDocumentTitle(title);

  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="relative isolate flex flex-col gap-4 overflow-hidden bg-sidebar px-6 py-6 text-sidebar-foreground sm:px-10 lg:sticky lg:top-0 lg:h-dvh lg:justify-between lg:gap-8 lg:px-14 lg:py-12">
        <div className="bay-lines absolute inset-x-0 bottom-0 -z-10 hidden h-1/3 text-sidebar-foreground opacity-50 lg:block" />
        <BrandMark tone="inverted" variant="compact" />
        <div className="space-y-2">
          <p className="text-xl leading-tight font-bold text-balance text-sidebar-accent-foreground lg:text-4xl">
            {branding.productName}
          </p>
          <p className="hidden max-w-sm text-sidebar-muted-foreground lg:block">{tagline}</p>
        </div>
        <InstitutionNotice className="hidden text-sidebar-muted-foreground lg:block" />
      </section>

      <section className="flex flex-1 flex-col px-4 py-4 sm:px-10 sm:py-6">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to={PATHS.home}>
              <ArrowLeft aria-hidden />
              {t('common.backToHome')}
            </Link>
          </Button>
          <LanguageSwitcher />
        </div>
        <div className="flex flex-1 items-start justify-center py-4 sm:items-center sm:py-8">
          <div className="w-full max-w-md space-y-6">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                {title}
              </h1>
              {description && <p className="text-muted-foreground">{description}</p>}
            </div>
            {children}
            {footer && (
              <div className="space-y-2 border-t pt-5 text-sm text-muted-foreground">{footer}</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
