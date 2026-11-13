import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { readFileSync, mkdtempSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Hermetic executable identity; never replaces the privileged runtime or host PATH.
const binaries = mkdtempSync(join(tmpdir(), 'sandbox-node-test-bin-'));
symlinkSync(process.execPath, join(binaries, 'runsc'));

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  cacheDir: '/tmp/sentropic-sandbox-node-vitest-cache',
  test: { env: { EXECUTION_NODE_PORTS_ENABLED: 'true', PATH: `${binaries}:${process.env.PATH}`,
    EXECUTION_NODE_PORTS_RUNSC_SHA256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex') },
    include: ['apps/sandbox-node/tests/**/*.test.ts'], pool: 'forks', fileParallelism: false },
});
