import { defineConfig, devices } from '@playwright/test';

const uiBaseUrl = process.env.UI_BASE_URL || 'http://ui:5173';
const apiBaseUrl = process.env.API_BASE_URL || 'http://api:8787';

export default defineConfig({
  testDir: './tests/dev',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: uiBaseUrl,
    storageState: './.auth/dev-state.json',
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
            '--allow-insecure-localhost',
          ],
        },
      },
    },
  ],
});
