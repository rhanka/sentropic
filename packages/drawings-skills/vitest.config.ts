import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    // mermaid is a heavy ESM import; real mermaid.parse (mermaid-validate) needs headroom.
    testTimeout: 30000,
  },
});
