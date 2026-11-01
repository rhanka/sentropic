// Vitest profile campaign: the FROZEN identity contract suite, UNMODIFIED,
// against durable A2.1 PostgreSQL stores. The alias redirects the suite's
// `createInMemoryIdentityStores` import to a shim that substitutes durable
// stores for the A2.1 slices (see tests/identity/profiles/postgres.ts); the
// spec files themselves are never touched.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/identity-*.spec.ts'],
    setupFiles: [fileURLToPath(new URL('./profiles/postgres.setup.ts', import.meta.url))],
    environment: 'node',
    alias: [
      {
        find: /^..\/src\/index\.js$/,
        replacement: fileURLToPath(new URL('./profiles/postgres.ts', import.meta.url)),
      },
    ],
  },
});
