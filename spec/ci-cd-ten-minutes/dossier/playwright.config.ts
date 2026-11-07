import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: 'controls.spec.ts', workers: 1, retries: 0,
  use: { headless: true, viewport: { width: 1440, height: 1000 } } });
