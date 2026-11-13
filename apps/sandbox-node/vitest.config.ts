import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  cacheDir: '/tmp/sentropic-sandbox-node-vitest-cache',
  test: { env: { EXECUTION_NODE_PORTS_ENABLED: 'true' }, include: ['apps/sandbox-node/tests/**/*.test.ts'], pool: 'forks', fileParallelism: false },
});
