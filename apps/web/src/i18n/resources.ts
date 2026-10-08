import type { Locale } from '@cpvts/shared';

import en from './locales/en.json';
import hi from './locales/hi.json';
import kn from './locales/kn.json';
import mr from './locales/mr.json';

/** English is the reference catalogue; every other locale must have identical keys. */
export type TranslationCatalogue = typeof en;

export const resources: Record<Locale, { translation: TranslationCatalogue }> = {
  en: { translation: en },
  kn: { translation: kn },
  hi: { translation: hi },
  mr: { translation: mr },
};
