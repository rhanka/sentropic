import { mkdtempSync, readFileSync, rmSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareBundle, destroyBundle } from '../src/bundle.js';

describe('OCI bundle lifecycle', () => {
  const owner = { uid: process.getuid!(), gid: process.getgid!() };
  it.each([[704, 512], [1536, 1024]])('should apply the signed OCI task limit for %i MiB', (quotaMiB, limit) => {
    const root = mkdtempSync(join(tmpdir(), 'bundle-pids-'));
    try {
      const bundle = prepareBundle({ tenantId: 'immo', sandboxUid: 'tasks', overlayUpper: join(root, 'upper'),
        overlayWork: join(root, 'work'), quotaMiB, diskQuotaMiB: 8, quotaInodes: 32, ...owner,
        command: ['/bin/true'], mounts: [
          { source: '/root.erofs', target: '/bases/rootfs/r', readOnly: true },
          { source: '/src.erofs', target: '/bases/source/s', readOnly: true }],
      }, () => {});
      expect(JSON.parse(readFileSync(join(bundle.path, 'config.json'), 'utf8')).linux.resources.pids.limit).toBe(limit);
      destroyBundle(bundle, () => {});
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('should install per-sandbox block and inode hard limits before mounting source', () => {
    const root = mkdtempSync(join(tmpdir(), 'disk-quota-'));
    const calls: string[][] = [];
    try {
      const bundle = prepareBundle({ tenantId: 'immo', sandboxUid: 'q', overlayUpper: join(root, 'upper'),
        overlayWork: join(root, 'work'), quotaMiB: 1536, diskQuotaMiB: 8, quotaInodes: 32, ...owner,
        command: ['/bin/sleep', 'infinity'], mounts: [
          { source: '/root.erofs', target: '/bases/rootfs/r', readOnly: true },
          { source: '/src.erofs', target: '/bases/source/s', readOnly: true }],
      } as Parameters<typeof prepareBundle>[0], (command, args) => { calls.push([command, ...args]); });
      const quota = calls.findIndex(call => call[0] === 'setquota');
      expect(quota).toBeGreaterThanOrEqual(0);
      expect(calls[quota]!.slice(1, 7)).toEqual(['-P', '1', '0', '8192', '0', '32']);
      expect(quota).toBeLessThan(calls.findIndex(call => call.includes('erofs')));
      destroyBundle(bundle, (command, args) => { calls.push([command, ...args]); });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('should reject symlinked output ancestors before creating anything outside the workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'bundle-link-'));
    const outside = join(root, 'outside'); mkdirSync(outside);
    try {
      expect(() => prepareBundle({ tenantId: 'immo', sandboxUid: 'link', overlayUpper: join(root, 'bundle/upper'),
        overlayWork: join(root, 'bundle/work'), quotaMiB: 1536, diskQuotaMiB: 512, quotaInodes: 1000, ...owner, command: ['/bin/sleep', 'infinity'],
        mounts: [{ source: '/root.erofs', target: '/bases/rootfs/root', readOnly: true },
          { source: '/source.erofs', target: '/bases/source/source', readOnly: true }] }, (command, args) => {
          if (command === 'mount' && args.includes('overlay')) symlinkSync(outside, join(root, 'bundle/workspace/ui'));
        })).toThrow();
      expect(existsSync(join(outside, 'dist'))).toBe(false);
    } finally { rmSync(root, { recursive: true }); }
  });
  it('should mount immutable bases, confine writes and purge all private files after unmount', () => {
    const root = mkdtempSync(join(tmpdir(), 'bundle-'));
    const calls: string[][] = [];
    const run = (command: string, args: string[]) => { calls.push([command, ...args]); };
    try {
      const bundle = prepareBundle({ tenantId: 'immo', sandboxUid: 'x', overlayUpper: join(root, 'upper'),
        overlayWork: join(root, 'work'), quotaMiB: 1536, diskQuotaMiB: 512, quotaInodes: 1000, ...owner, command: ['/bin/sleep', 'infinity'],
        mounts: [{ source: '/root.erofs', target: '/bases/rootfs/root', readOnly: true },
          { source: '/source.erofs', target: '/bases/source/source', readOnly: true }] }, run);
      const config = JSON.parse(readFileSync(join(bundle.path, 'config.json'), 'utf8'));
      expect(config.process.args).toEqual(['/bin/sleep', 'infinity']);
      expect(config.process.user).toEqual(owner);
      expect(config.root.readonly).toBe(true);
      expect(config.mounts.find((mount: { destination: string }) => mount.destination === '/workspace').options).toContain('ro');
      expect(config.linux.namespaces.map((ns: { type: string }) => ns.type)).toContain('network');
      expect(calls.filter(call => call.includes('erofs'))).toHaveLength(2);
      destroyBundle(bundle, run);
      expect(calls.filter(call => call[0] === 'umount')).toHaveLength(4);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
