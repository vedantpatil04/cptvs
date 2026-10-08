/** CPVTS supports exactly four languages (Master Blueprint §41). */
export const SUPPORTED_LOCALES = ['en', 'kn', 'hi', 'mr'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
