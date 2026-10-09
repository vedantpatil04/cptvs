// Builds the web app for the Android app and syncs it into the Capacitor project.
//
// 1. Resolves the API base URL exactly like `vite build` does (VITE_API_BASE_URL, else the
//    legacy VITE_API_URL, from the environment / .env.production).
// 2. Refuses a URL that could never work on a phone: missing, plain http, localhost or a
//    private network address (including the emulator alias 10.0.2.2).
// 3. Builds with that one validated URL forced into both variables, so a developer's local
//    .env can never leak a localhost API address into the APK.
// 4. Runs `cap sync android`.
/* eslint-disable no-console */
/* global process, console, URL */
import { spawnSync } from 'node:child_process';

import { loadEnv } from 'vite';

const env = loadEnv('production', process.cwd(), 'VITE_');
const raw = (env.VITE_API_BASE_URL || env.VITE_API_URL || '').trim();

const fail = (reason) => {
  console.error(`\n[android] Refusing to build: ${reason}`);
  console.error(
    '[android] Set VITE_API_BASE_URL to the public HTTPS URL of the API, e.g. in apps/web/.env.production.\n',
  );
  process.exit(1);
};

if (!raw) fail('VITE_API_BASE_URL is not set.');

let url;
try {
  url = new URL(raw);
} catch {
  fail(`VITE_API_BASE_URL "${raw}" is not a valid URL.`);
}

const host = url.hostname.toLowerCase();
const privateHost =
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

if (privateHost) fail(`VITE_API_BASE_URL points at a local or private address (${host}).`);
if (url.protocol !== 'https:') fail(`VITE_API_BASE_URL must use https (got ${url.protocol}).`);

console.log(`[android] API base URL: ${url.origin}`);

const run = (command, args, extraEnv = {}) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const apiEnv = { VITE_API_BASE_URL: url.origin, VITE_API_URL: url.origin };
run('npm', ['run', 'build'], apiEnv);
run('npx', ['cap', 'sync', 'android'], apiEnv);
