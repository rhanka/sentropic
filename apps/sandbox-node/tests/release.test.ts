import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('pinned VM release startup', () => {
  it('should preserve host-visible mounts and require both tenant filesystems', () => {
    const unit = readFileSync(new URL('../k8s/execution-node.service', import.meta.url), 'utf8');
    for (const directive of ['ProtectSystem', 'ProtectHome', 'PrivateTmp', 'ReadWritePaths', 'MountFlags', 'ProtectControlGroups', 'PrivateDevices', 'Delegate']) {
      expect(unit).not.toMatch(new RegExp(`^${directive}=`, 'm'));
    }
    for (const line of ['User=root', 'CPUWeight=100', 'RuntimeDirectoryPreserve=yes',
      'RequiresMountsFor=/var/lib/builder/tenants/sentropic /var/lib/builder/tenants/immo',
      'RuntimeDirectory=execution-node', 'MemoryMax=192M', 'MemoryMin=64M', 'OOMPolicy=kill']) expect(unit).toContain(line);
  });
  it('should align the default listener and operator instructions on TCP 8443', () => {
    expect(readFileSync(new URL('../src/service.ts', import.meta.url), 'utf8')).toContain('AGENT_PORT ?? 8443');
    const guide = readFileSync(new URL('../OPERATOR.md', import.meta.url), 'utf8');
    expect(guide).toContain('TCP 8443');
    expect(guide).not.toContain('9443');
  });
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
