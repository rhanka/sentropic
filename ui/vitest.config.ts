import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['src/**'],
    environment: 'jsdom',
    setupFiles: ['tests/test-setup.ts'],
    globals: true,
    clearMocks: true,
    restoreMocks: true
  }
});
