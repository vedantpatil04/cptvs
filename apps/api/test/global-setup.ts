import { execFileSync } from 'node:child_process';

import { testEnv } from './test-env.js';

/** Applies all migrations to the test database once per run. */
export default function setup(): void {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, ...testEnv },
  });
}
