import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android app shell for the CPVTS web client.
 *
 * Default ("remote"): the WebView opens the deployed web app, so UI updates reach the phone
 * through Vercel without rebuilding the APK. Capacitor injects its native bridge into that
 * page (the server URL is an allowed origin), which is what lets the web app use the native
 * QR scanner. If the page can not be loaded (no network, server waking up) the WebView shows
 * the bundled `offline.html` with a retry button.
 *
 * `CPVTS_WEB_URL=bundled` ships the built web app inside the APK instead (served from
 * https://localhost). It works without network for the shell and is the fallback if a device's
 * WebView does not support the native bridge for a remote origin; the trade-off is that every UI
 * change needs a new APK, and the API must allow the https://localhost CORS origin.
 *
 * The API URL is never set here: it is compiled into the web build (VITE_API_BASE_URL).
 */
const DEFAULT_WEB_URL = 'https://cptvs-8v1z.vercel.app';

const configured = (process.env.CPVTS_WEB_URL ?? DEFAULT_WEB_URL).trim();
const bundled = configured === '' || configured === 'bundled';

const config: CapacitorConfig = {
  appId: 'com.cpvts.app',
  appName: 'CPVTS',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
    ...(bundled
      ? {}
      : {
          url: configured,
          // The WebView may only navigate within the app's own site; everything else opens outside.
          allowNavigation: [new URL(configured).hostname],
          errorPath: 'offline.html',
        }),
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
