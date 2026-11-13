import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { FakeRuntimeAdapter, RunscRuntimeAdapter } from '../src/index.js';
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

describe('runtime adapters', () => {
  it('should reject a launcher failure after spawn instead of reporting running', async () => {
    const adapter = new RunscRuntimeAdapter('runsc', { prepare: () => ({ path: '/tmp', workspace: '/tmp/workspace', output: '/tmp/output', mounted: [] }), destroy: () => {} });
    vi.spyOn(adapter, 'hasRunsc').mockReturnValue(true);
    const child = new EventEmitter();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => { child.emit('spawn'); queueMicrotask(() => child.emit('exit', 1, null)); });
      return child as ReturnType<typeof spawn>;
    });
    try {
      await expect(adapter.runSandbox({ tenantId: 'immo', sandboxUid: 'bad-start', mounts: [],
        overlayUpper: '/tmp/upper', overlayWork: '/tmp/work', quotaMiB: 704, uid: 1000, gid: 1000 }))
        .rejects.toThrow();
    } finally { vi.restoreAllMocks(); }
  });
  it('should start transient tenant scopes with protected warm memory and bounded build resources', async () => {
    const adapter = new RunscRuntimeAdapter('runsc', { prepare: () => ({ path: '/tmp', workspace: '/tmp/w', output: '/tmp/o', mounted: [] }), destroy: () => {} });
    vi.spyOn(adapter, 'hasRunsc').mockReturnValue(true);
    const calls: string[][] = [];
    vi.mocked(spawn).mockImplementation((_file, args) => {
      calls.push(args as string[]); const child = new EventEmitter();
      queueMicrotask(() => child.emit('error', new Error('fixture launch failure')));
      return child as ReturnType<typeof spawn>;
    });
    try {
      for (const quotaMiB of [704, 1536]) await expect(adapter.runSandbox({ tenantId: 'immo', sandboxUid: 'limits',
        mounts: [], overlayUpper: '/tmp/upper', overlayWork: '/tmp/work', quotaMiB, uid: 1000, gid: 1000 })).rejects.toThrow();
      expect(calls[0]).toEqual(expect.arrayContaining(['--scope', '--slice=builder-tenant-immo.slice',
        '--property=MemoryLow=704M', '--property=CPUWeight=200', '--property=OOMPolicy=kill', '--property=TasksMax=512']));
      expect(calls[1]).toEqual(expect.arrayContaining(['--property=MemoryHigh=1408M', '--property=CPUWeight=100', '--property=MemoryLow=0', '--property=TasksMax=1024']));
      expect(calls.flat()).not.toContain('--property=MemoryOOMGroup=yes');
      expect(calls.flat()).toContain('--root=/run/execution-node/runsc');
    } finally { vi.restoreAllMocks(); }
  });
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
