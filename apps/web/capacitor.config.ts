import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android app shell for the CPVTS web client. It ships the same built web app (`dist`) and
 * talks to the same API; the API URL is compiled in from VITE_API_BASE_URL at build time
 * (see `npm run build:android`), never from this file.
 *
 * The WebView is served from https://localhost, so that origin must be listed in the API's
 * CORS_ORIGINS for the app to be able to call it.
 */
const config: CapacitorConfig = {
  appId: 'com.cpvts.app',
  appName: 'CPVTS',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
