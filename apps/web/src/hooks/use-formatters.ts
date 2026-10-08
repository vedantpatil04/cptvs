import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { LANGUAGES } from '@/i18n/languages';

const toDate = (value: string | Date) => (typeof value === 'string' ? new Date(value) : value);

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
    const time = new Intl.DateTimeFormat(intlLocale, { timeStyle: 'short' });
    const number = new Intl.NumberFormat(intlLocale);
    const rupees = new Intl.NumberFormat(intlLocale, {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    return {
      dateTime: (value: string | Date) => dateTime.format(toDate(value)),
      time: (value: string | Date) => time.format(toDate(value)),
      number: (value: number) => number.format(value),
      /** Formats an integer amount in paise as rupees, e.g. 1000 → "₹10". */
      paise: (value: number) => rupees.format(value / 100),
    };
  }, [intlLocale]);
};
