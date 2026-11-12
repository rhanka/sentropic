import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('pinned VM release startup', () => {
  const script = fileURLToPath(new URL('../k8s/start.sh', import.meta.url));
  it('should reject mutable tags, malformed digests and untrusted release roots before executing Node', () => {
    for (const release of ['latest', '/opt/sandbox-node/releases/latest',
      '/opt/sandbox-node/releases/sha256:abc', `/tmp/${'a'.repeat(64)}`, '']) {
      const result = spawnSync('sh', [script], { env: { ...process.env, RELEASE_DIR: release } });
      expect(result.status).not.toBe(0);
      expect(result.stderr.toString()).not.toContain('AGENT_CA');
    }
  });
});
