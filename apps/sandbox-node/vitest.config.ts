import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  cacheDir: '/tmp/sentropic-sandbox-node-vitest-cache',
  test: { env: { EXECUTION_NODE_PORTS_ENABLED: 'true', EXECUTION_NODE_RUNSC: process.execPath,
    EXECUTION_NODE_PORTS_RUNSC_SHA256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex') },
    include: ['apps/sandbox-node/tests/**/*.test.ts'], pool: 'forks', fileParallelism: false },
});
