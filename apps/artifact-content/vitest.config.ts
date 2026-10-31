import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  cacheDir: '/tmp/sentropic-content-vitest-cache',
  test: { include: ['apps/artifact-content/tests/**/*.test.ts'], pool: 'forks', fileParallelism: false },
});
