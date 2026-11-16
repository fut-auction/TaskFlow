import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', testMatch: '**/taskflow.spec.ts', use: devices['Desktop Chrome'] },
    {
      name: 'guest',
      testMatch: '**/guest.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' },
    },
  ],
  webServer: [
    {
      command: 'node tests/support/server.mjs',
      url: 'http://127.0.0.1:4173/api/config',
      reuseExistingServer: false,
    },
    {
      command: 'node tests/support/guest-server.mjs',
      url: 'http://127.0.0.1:18188/healthz',
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://localhost:5173',
      env: { TASKFLOW_API_TARGET: 'http://127.0.0.1:18188' },
      reuseExistingServer: true,
    },
  ],
});
