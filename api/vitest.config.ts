import { defineConfig } from 'vitest/config';

const maxForks = process.env.VITEST_MAX_WORKERS
  ? Number(process.env.VITEST_MAX_WORKERS)
  : undefined;

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        // Keep minForks bounded when maxForks is forced via env to avoid Tinypool conflicts.
        ...(maxForks !== undefined ? { minForks: 1, maxForks } : {}),
      }
    },
    // Increase timeout for database operations and AI API calls
    testTimeout: 60000,
    // Setup files
    setupFiles: [],
  },
});
