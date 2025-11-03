import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '$lib': path.resolve(__dirname, './src/lib'),
      '$app': path.resolve(__dirname, './tests/mocks/$app'),
    }
  },
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
