import { describe, expect, it } from 'vitest';
import { FakeRuntimeAdapter, RunscRuntimeAdapter } from '../src/index.js';

describe('runtime adapters', () => {
  it('runs, stops, exports and destroys with the fake adapter', async () => {
    const adapter = new FakeRuntimeAdapter();
    expect(adapter.hasRunsc()).toBe(false);
    const { runtimeId } = await adapter.runSandbox({
      tenantId: 'sentropic',
      sandboxUid: 'u1',
      mounts: [],
      overlayUpper: '/upper',
      overlayWork: '/work',
      quotaMiB: 512,
      uid: 1000,
      gid: 1000,
    });
    expect(adapter.isLive(runtimeId)).toBe(true);
    await adapter.stopSandbox(runtimeId);
    expect(adapter.isLive(runtimeId)).toBe(false);
    const bytes = await adapter.exportOutput(runtimeId, 'ui/dist');
    expect(bytes.length).toBeGreaterThan(0);
    await adapter.destroySandbox(runtimeId);
  });

  it('compiles the real runsc adapter but exercises it only where runsc exists', async () => {
    const adapter = new RunscRuntimeAdapter('/nonexistent-runsc-binary');
    expect(adapter.kind).toBe('runsc-systrap');
    expect(adapter.hasRunsc()).toBe(false);
    const args = adapter.runscArgs({
      tenantId: 'immo',
      sandboxUid: 'u2',
      mounts: [{ source: '/bases/rootfs/x.erofs', target: '/bases/rootfs/base', readOnly: true }],
      overlayUpper: '/upper',
      overlayWork: '/work',
      quotaMiB: 512,
      uid: 1000,
      gid: 1000,
    });
    expect(args).toContain('--network=none');
    expect(args).toContain('--platform=systrap');
    await expect(adapter.runSandbox({
      tenantId: 'immo',
      sandboxUid: 'u2',
      mounts: [],
      overlayUpper: '/upper',
      overlayWork: '/work',
      quotaMiB: 512,
      uid: 1000,
      gid: 1000,
    })).rejects.toThrowError(/runsc/);
  });
});
