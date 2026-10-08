import { useTranslation } from 'react-i18next';

import { branding } from '@/config/branding';
import { cn } from '@/lib/utils';

/**
 * Names the institution the deployment is prepared for and — unless the
 * deployment is authorised as official — states that it is a demonstration.
 */
export function InstitutionNotice({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn('space-y-1 text-xs', className)}>
      <p className="font-medium">{branding.institutionName}</p>
      {branding.showDemoNotice && (
        <p className="opacity-80">
          {t('branding.demoNotice', { institution: branding.institutionName })}
        </p>
      )}
    </div>
  );
}
