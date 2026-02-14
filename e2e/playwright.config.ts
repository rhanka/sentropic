import { defineConfig, devices } from '@playwright/test';

const uiBaseUrl = process.env.UI_BASE_URL || 'http://localhost:5173';
const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8787';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: true,
  retries: 2,
  workers: 4,
  reporter: 'list',
  globalSetup: './global.setup.ts',
  use: {
    baseURL: uiBaseUrl,
    storageState: './.auth/state.json',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            `--unsafely-treat-insecure-origin-as-secure=${uiBaseUrl},${apiBaseUrl}`,
            '--allow-insecure-localhost'
          ]
        }
      },
    },
  ],
  // webServer disabled - services are managed by docker-compose
});
