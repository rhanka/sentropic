import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A1a-EX1: resolve @sentropic/chat-ui-core to the local package source so
// the test-chat-ui Docker container (which only links vitest+svelte, not
// node_modules/@sentropic) can resolve the re-export shims without a
// Makefile change.
export default defineConfig({
  resolve: {
    alias: {
      '@sentropic/chat-ui-core': path.resolve(__dirname, '../chat-ui-core/src'),
    },
  },
  test: {
    environment: 'node',
  },
});
