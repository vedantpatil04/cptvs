import type { Locale } from '@cpvts/shared';

export interface LanguageOption {
  code: Locale;
  /** The language's own name (endonym), shown regardless of the active language. */
  nativeName: string;
  /**
   * BCP 47 tag for date and number formatting. Latin digits (`nu-latn`) are
   * used in every language so times, amounts and vehicle numbers read the same.
   */
  intlLocale: string;
}

/** The four CPVTS languages, in display order. */
export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'en', nativeName: 'English', intlLocale: 'en-IN-u-nu-latn' },
  { code: 'kn', nativeName: 'ಕನ್ನಡ', intlLocale: 'kn-IN-u-nu-latn' },
  { code: 'hi', nativeName: 'हिन्दी', intlLocale: 'hi-IN-u-nu-latn' },
  { code: 'mr', nativeName: 'मराठी', intlLocale: 'mr-IN-u-nu-latn' },
];
