import { execFileSync } from 'node:child_process';

import { testEnv } from './test-env.js';

/** Applies all migrations to the test database once per run. */
export default function setup(): void {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npxCmd, ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...testEnv },
  });
}
