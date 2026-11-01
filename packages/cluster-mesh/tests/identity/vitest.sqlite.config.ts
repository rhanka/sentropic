// Vitest profile campaign: the FROZEN identity contract suite, UNMODIFIED,
// against durable A2.1 SQLite local stores. Same alias contract as the
// PostgreSQL campaign, with the SQLite shim (tests/identity/profiles/sqlite.ts).

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/identity-*.spec.ts'],
    setupFiles: [fileURLToPath(new URL('./profiles/sqlite.setup.ts', import.meta.url))],
    environment: 'node',
    alias: [
      {
        find: /^..\/src\/index\.js$/,
        replacement: fileURLToPath(new URL('./profiles/sqlite.ts', import.meta.url)),
      },
    ],
  },
});
