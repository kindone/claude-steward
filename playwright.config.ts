import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Start the full dev stack before tests. Tests assume Claude is NOT called
  // (no real messages sent) so a running server + client is sufficient.
  webServer: [
    {
      command: 'npm run dev --workspace=server',
      url: 'http://localhost:3001/api/sessions',
      reuseExistingServer: true,
      timeout: 15_000,
      env: { API_KEY: process.env.API_KEY ?? 'steward-e2e-test-key' },
    },
    {
      command: 'npm run dev --workspace=client',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 15_000,
    },
  ],
})
