import { defineConfig } from 'vitest/config';

const maxForks = process.env.VITEST_MAX_WORKERS
  ? Number(process.env.VITEST_MAX_WORKERS)
  : undefined;

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        ...(maxForks !== undefined && { maxForks }),
      }
    },
    // Increase timeout for database operations and AI API calls
    testTimeout: 60000,
    // Setup files
    setupFiles: [],
  },
});