// Builds the web app for the Android app and syncs it into the Capacitor project.
//
// 1. Resolves the API base URL exactly like `vite build` does (VITE_API_BASE_URL, else the
//    legacy VITE_API_URL, from the environment / .env.production).
// 2. Refuses a URL that could never work on a phone: missing, plain http, localhost or a
//    private network address (including the emulator alias 10.0.2.2).
// 3. Builds with that one validated URL forced into both variables, so a developer's local
//    .env can never leak a localhost API address into the APK.
// 4. Writes the offline/retry page shown when the remote site can not be loaded.
// 5. Runs `cap sync android`.
//
// Default: the app opens the deployed web app (CPVTS_WEB_URL, default the Vercel site).
// `--bundled` ships the built web app inside the APK instead (see capacitor.config.ts).
/* eslint-disable no-console */
/* global process, console, URL */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadEnv } from 'vite';

const bundled = process.argv.includes('--bundled');
const DEFAULT_WEB_URL = 'https://cptvs-8v1z.vercel.app';

const env = loadEnv('production', process.cwd(), 'VITE_');
const raw = (env.VITE_API_BASE_URL || env.VITE_API_URL || '').trim();

const fail = (reason) => {
  console.error(`\n[android] Refusing to build: ${reason}`);
  console.error(
    '[android] Set VITE_API_BASE_URL to the public HTTPS URL of the API, e.g. in apps/web/.env.production.\n',
  );
  process.exit(1);
};

const isPrivateHost = (host) =>
  host === 'localhost' ||
  host === '0.0.0.0' ||
  host === '::1' ||
  host === '[::1]' ||
  host === '10.0.2.2' || // the Android emulator's alias for the developer machine
  host.endsWith('.local') ||
  host.endsWith('.localhost') ||
  host.endsWith('.invalid') ||
  /^127\./.test(host) ||
  /^10\./.test(host) ||
  /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(host);

const checkHttpsPublicUrl = (name, value) => {
  if (!value) fail(`${name} is not set.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} "${value}" is not a valid URL.`);
  }
  if (isPrivateHost(url.hostname.toLowerCase())) {
    fail(`${name} points at a local or private address (${url.hostname}).`);
  }
  if (url.protocol !== 'https:') fail(`${name} must use https (got ${url.protocol}).`);
  return url;
};

const apiUrl = checkHttpsPublicUrl('VITE_API_BASE_URL', raw);
console.log(`[android] API base URL: ${apiUrl.origin}`);

// The page the WebView opens: the deployed web app, or the bundled build.
const requestedWebUrl = bundled
  ? 'bundled'
  : (process.env.CPVTS_WEB_URL ?? DEFAULT_WEB_URL).trim() || 'bundled';
const webUrl =
  requestedWebUrl === 'bundled'
    ? 'bundled'
    : checkHttpsPublicUrl('CPVTS_WEB_URL', requestedWebUrl).origin;
console.log(
  webUrl === 'bundled'
    ? '[android] Mode: bundled web app inside the APK'
    : `[android] Mode: WebView opens ${webUrl}`,
);

const run = (command, args, extraEnv = {}) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const buildEnv = { VITE_API_BASE_URL: apiUrl.origin, VITE_API_URL: apiUrl.origin };
run('npm', ['run', 'build'], buildEnv);

// The retry page needs to know where to go back to.
const template = readFileSync(path.resolve('android-shell', 'offline.html'), 'utf8');
writeFileSync(
  path.resolve('dist', 'offline.html'),
  template.replaceAll('__CPVTS_WEB_URL__', webUrl === 'bundled' ? '/' : webUrl),
);

run('npx', ['cap', 'sync', 'android'], { ...buildEnv, CPVTS_WEB_URL: webUrl });
