import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'v8-preview.spec.ts',
  outputDir: '/results/traces',
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '/results/playwright.json' }]],
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({
    name: browserName,
    use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit' },
  })),
});
