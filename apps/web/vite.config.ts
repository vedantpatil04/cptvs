import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

import { BRANDING_DEFAULTS } from './src/config/branding-defaults.ts';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // Fill branding variables that are set neither in the environment nor in an
  // env file, so index.html placeholders and the runtime config always resolve.
  for (const [key, value] of Object.entries(BRANDING_DEFAULTS)) {
    if (!env[key]) process.env[key] = value;
  }

  const rawApiUrl = (env.VITE_API_BASE_URL || env.VITE_API_URL || '').trim();
  if (command === 'build' && mode !== 'test' && !rawApiUrl) {
    throw new Error(
      'VITE_API_BASE_URL (or VITE_API_URL) must be set when building the CPVTS web app.',
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    preview: {
      port: 4173,
    },
    build: {
      sourcemap: true,
      rolldownOptions: {
        output: {
          // Long-lived vendor chunks cache well across application releases.
          codeSplitting: {
            groups: [
              {
                name: 'react',
                test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
                priority: 2,
              },
              { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
            ],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      env: {
        VITE_API_BASE_URL: 'http://localhost:4000',
        VITE_API_URL: 'http://localhost:4000',
      },
    },
  };
});
