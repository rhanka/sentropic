import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: process.env.SPIKE_SPEC || ['v8-preview.spec.ts', 'v8-delivery.spec.ts', 'v8-hmr.spec.ts', 'v8-compiler.spec.ts'],
  outputDir: '/results/traces',
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '/results/playwright.json' }]],
  projects: ['chromium', 'firefox', 'webkit'].filter(name => !process.env.SPIKE_BROWSER || name === process.env.SPIKE_BROWSER).map(browserName => ({
    name: browserName,
    use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit' },
  })),
});
