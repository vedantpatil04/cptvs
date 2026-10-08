import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/feedback/StatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { DescriptionItem, DescriptionList } from '@/components/ui/description-list';
import { useCurrentUser } from '@/features/auth/use-auth';
import { useFormatters } from '@/hooks/use-formatters';

export function AccountPage() {
  const { t } = useTranslation();
  const format = useFormatters();
  const { user } = useCurrentUser();

  return (
    <>
      <PageHeader title={t('account.title')} description={t('account.description')} />
      <Card className="max-w-3xl">
        <CardContent>
          <DescriptionList>
            <DescriptionItem label={t('account.fullName')}>{user.fullName}</DescriptionItem>
            <DescriptionItem label={t('account.username')}>{user.username}</DescriptionItem>
            <DescriptionItem label={t('account.role')}>
              <StatusBadge tone="info">{t(`roles.${user.role}`)}</StatusBadge>
            </DescriptionItem>
            <DescriptionItem label={t('account.status')}>
              <StatusBadge tone="success" dot>
                {t('account.active')}
              </StatusBadge>
            </DescriptionItem>
            <DescriptionItem label={t('account.lastSignIn')}>
              {user.lastLoginAt ? format.dateTime(user.lastLoginAt) : t('account.never')}
            </DescriptionItem>
          </DescriptionList>
        </CardContent>
      </Card>
    </>
  );
}
