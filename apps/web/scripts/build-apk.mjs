// Builds the debug APK with the Gradle wrapper of the Capacitor Android project and verifies
// that the artifact exists. Run via `npm run android:apk` (which syncs the web build first).
/* eslint-disable no-console */
/* global process, console */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const androidDir = path.resolve('android');
if (!existsSync(androidDir)) {
  console.error('[android] No android/ project here. Run `npx cap add android` first.');
  process.exit(1);
}

const windows = process.platform === 'win32';
const result = spawnSync(windows ? '.\\gradlew.bat' : './gradlew', ['assembleDebug'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: windows,
});
if (result.status !== 0) {
  console.error(`[android] Gradle failed (exit ${String(result.status)}).`);
  process.exit(result.status ?? 1);
}

const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!existsSync(apk)) {
  console.error(`[android] Gradle reported success but ${apk} does not exist.`);
  process.exit(1);
}
const megabytes = (statSync(apk).size / 1024 / 1024).toFixed(1);
console.log(`[android] Debug APK built: ${apk} (${megabytes} MB)`);
