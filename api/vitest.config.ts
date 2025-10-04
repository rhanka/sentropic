import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: process.env.TEST_FILTER ? [`tests/**/${process.env.TEST_FILTER}*.test.ts`] : ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000, // 30s pour les tests IA
    hookTimeout: 10000, // 10s pour les hooks
  },
});
