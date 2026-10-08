import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { LANGUAGES } from '@/i18n/languages';

/** Locale-aware formatters for the active language (Indian regional formats). */
export const useFormatters = () => {
  const { i18n } = useTranslation();
  const intlLocale =
    LANGUAGES.find((lang) => lang.code === i18n.language)?.intlLocale ?? 'en-IN-u-nu-latn';

  return useMemo(() => {
    const dateTime = new Intl.DateTimeFormat(intlLocale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const number = new Intl.NumberFormat(intlLocale);
    return {
      dateTime: (value: string | Date) =>
        dateTime.format(typeof value === 'string' ? new Date(value) : value),
      number: (value: number) => number.format(value),
    };
  }, [intlLocale]);
};
