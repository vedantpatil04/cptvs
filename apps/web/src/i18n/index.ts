import { isLocale, SUPPORTED_LOCALES, type Locale } from '@cpvts/shared';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { appConfig } from '@/config/env';

import { resources } from './resources';

const STORAGE_KEY = 'cpvts.locale';

const readStoredLocale = (): Locale | null => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
};

const persistLocale = (locale: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable (private mode, WebView restrictions); the choice simply won't persist.
  }
};

const applyDocumentLanguage = (locale: string): void => {
  document.documentElement.lang = locale;
};

void i18n.use(initReactI18next).init({
  resources,
  lng: readStoredLocale() ?? appConfig.defaultLocale,
  fallbackLng: 'en',
  supportedLngs: [...SUPPORTED_LOCALES],
  interpolation: { escapeValue: false }, // React already escapes rendered values.
  returnNull: false,
});

applyDocumentLanguage(i18n.language);
i18n.on('languageChanged', (locale) => {
  applyDocumentLanguage(locale);
  persistLocale(locale);
});

export const currentLocale = (): Locale => (isLocale(i18n.language) ? i18n.language : 'en');

export default i18n;
