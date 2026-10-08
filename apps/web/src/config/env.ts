import { DEFAULT_LOCALE, isLocale, type Locale } from '@cpvts/shared';

/**
 * Runtime configuration for the web client, resolved once from Vite's
 * build-time environment. Everything here is public — never put secrets in
 * VITE_* variables.
 */
const resolveApiUrl = (): string => {
  const value =
    import.meta.env.VITE_API_URL?.trim() || (import.meta.env.DEV ? 'http://localhost:4000' : '');
  return value.replace(/\/+$/, '');
};

const resolveDefaultLocale = (): Locale => {
  const value = import.meta.env.VITE_DEFAULT_LOCALE;
  return isLocale(value) ? value : DEFAULT_LOCALE;
};

export const appConfig = Object.freeze({
  apiBaseUrl: `${resolveApiUrl()}/api/v1`,
  healthUrl: `${resolveApiUrl()}/health`,
  defaultLocale: resolveDefaultLocale(),
});
