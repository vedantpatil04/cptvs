import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { appConfig } from '@/config/env';
import { LANGUAGES } from '@/i18n/languages';

const toDate = (value: string | Date) => (typeof value === 'string' ? new Date(value) : value);

/** Locale-aware formatters for the active language (Indian regional formats). */
export const useFormatters = () => {
  const { i18n } = useTranslation();
  const intlLocale =
    LANGUAGES.find((lang) => lang.code === i18n.language)?.intlLocale ?? 'en-IN-u-nu-latn';

  return useMemo(() => {
    // Every instant is shown on the campus clock, whatever the device's own time zone is.
    const timeZone = appConfig.campusTimeZone;
    const dateTime = new Intl.DateTimeFormat(intlLocale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    });
    const date = new Intl.DateTimeFormat(intlLocale, { dateStyle: 'medium', timeZone });
    const time = new Intl.DateTimeFormat(intlLocale, { timeStyle: 'short', timeZone });
    const number = new Intl.NumberFormat(intlLocale);
    const rupees = new Intl.NumberFormat(intlLocale, {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    return {
      dateTime: (value: string | Date) => dateTime.format(toDate(value)),
      date: (value: string | Date) => date.format(toDate(value)),
      time: (value: string | Date) => time.format(toDate(value)),
      number: (value: number) => number.format(value),
      /** Formats an integer amount in paise as rupees, e.g. 1000 → "₹10". */
      paise: (value: number) => rupees.format(value / 100),
    };
  }, [intlLocale]);
};
