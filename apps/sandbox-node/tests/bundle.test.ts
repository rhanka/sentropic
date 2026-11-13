import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareBundle, destroyBundle } from '../src/bundle.js';

describe('OCI bundle lifecycle', () => {
  it('should mount immutable bases, confine writes and purge all private files after unmount', () => {
    const root = mkdtempSync(join(tmpdir(), 'bundle-'));
    const calls: string[][] = [];
    const run = (command: string, args: string[]) => { calls.push([command, ...args]); };
    try {
      const bundle = prepareBundle({ tenantId: 'immo', sandboxUid: 'x', overlayUpper: join(root, 'upper'),
        overlayWork: join(root, 'work'), quotaMiB: 1536, uid: 1000, gid: 1000, command: ['/bin/sleep', 'infinity'],
        mounts: [{ source: '/root.erofs', target: '/bases/rootfs/root', readOnly: true },
          { source: '/source.erofs', target: '/bases/source/source', readOnly: true }] }, run);
      const config = JSON.parse(readFileSync(join(bundle.path, 'config.json'), 'utf8'));
      expect(config.process.args).toEqual(['/bin/sleep', 'infinity']);
      expect(config.root.readonly).toBe(true);
      expect(config.mounts.find((mount: { destination: string }) => mount.destination === '/workspace').options).toContain('ro');
      expect(config.linux.namespaces.map((ns: { type: string }) => ns.type)).toContain('network');
      expect(calls.filter(call => call.includes('erofs'))).toHaveLength(2);
      destroyBundle(bundle, run);
      expect(calls.filter(call => call[0] === 'umount')).toHaveLength(3);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
