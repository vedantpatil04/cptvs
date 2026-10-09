import { DEFAULT_LOCALE, isLocale, type Locale } from '@cpvts/shared';

/**
 * Runtime configuration for the web client, resolved once from Vite's
 * build-time environment. Everything here is public — never put secrets in
 * VITE_* variables.
 */
/**
 * Normalises an API root URL by removing trailing slashes and stripping
 * any trailing /api/v1 or /api suffix if the user supplied the full endpoint.
 */
export const normalizeApiRoot = (rawUrl?: string): string => {
  if (!rawUrl) return '';
  let url = rawUrl.trim().replace(/\/+$/, '');
  if (url.endsWith('/api/v1')) {
    url = url.slice(0, -7);
  } else if (url.endsWith('/api')) {
    url = url.slice(0, -4);
  }
  return url.replace(/\/+$/, '');
};

const resolveApiUrl = (): string => {
  const configured =
    import.meta.env.VITE_API_BASE_URL?.trim() || import.meta.env.VITE_API_URL?.trim();

  if (configured) {
    return normalizeApiRoot(configured);
  }

  // During local development or testing, fall back to the local API server
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    return 'http://localhost:4000';
  }

  // Production builds must never silently fall back to localhost
  throw new Error(
    'Missing API URL. Please configure VITE_API_BASE_URL (or VITE_API_URL) in your environment variables.',
  );
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
