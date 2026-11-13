import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('pinned VM release startup', () => {
  it('should document AMD-27 provenance custody in the operator guide and local specification', () => {
    for (const file of ['../OPERATOR.md', '../../../spec/SPEC_EVOL_SANDBOX_NODE.md']) {
      const text = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(text).toContain('root 0400');
      expect(text).toContain('annually and on every rebuild');
      expect(text).toContain('public revocation and rebuild on compromise');
    }
  });
  it('should pin the current RUN 9 delivery instead of the superseded RUN 8 archive', () => {
    const pins = readFileSync(new URL('../k8s/PINS.md', import.meta.url), 'utf8');
    expect(pins).toContain('## RUN 9 delivery (supersedes prior compiled releases)');
    expect(pins).not.toContain('## RUN 8 delivery (supersedes prior compiled releases)');
  });
  it('should execute the shipped SEA without a host Node interpreter', () => {
    const start = readFileSync(new URL('../k8s/start.sh', import.meta.url), 'utf8');
    expect(start).toContain('exec ./execution-node');
    expect(start).not.toContain('/usr/bin/node');
  });
  it('should preserve host-visible mounts and require both tenant filesystems', () => {
    const unit = readFileSync(new URL('../k8s/execution-node.service', import.meta.url), 'utf8');
    const guide = readFileSync(new URL('../OPERATOR.md', import.meta.url), 'utf8');
    expect(guide).toContain('```systemd\n' + unit + '```');
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
