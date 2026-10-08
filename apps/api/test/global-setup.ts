import { execFileSync } from 'node:child_process';

import { testEnv } from './test-env.js';

/** Applies all migrations to the test database once per run. */
export default function setup(): void {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    // npx is a .cmd shim on Windows and cannot be spawned directly.
    shell: process.platform === 'win32',
    env: { ...process.env, ...testEnv },
  });
}
