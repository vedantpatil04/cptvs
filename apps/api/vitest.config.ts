import { defineConfig } from 'vitest/config';

import { testEnv } from './test/test-env.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Integration tests share one database, so run files sequentially.
    fileParallelism: false,
    env: testEnv,
  },
});
