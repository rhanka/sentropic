import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/qualification', testMatch: 'session-content-real.spec.ts',
  globalSetup: undefined, workers: 1, retries: 0, reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5582', trace: 'off', screenshot: 'off' },
});
