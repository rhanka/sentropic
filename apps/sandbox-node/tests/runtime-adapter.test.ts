import { describe, expect, it, vi } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { privateNetworkScript } from '../src/private-network.js';
import { FakeRuntimeAdapter, RunscRuntimeAdapter, createExecutionNode, ExecutionNodeDaemon } from '../src/index.js';
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn), execFileSync: vi.fn(actual.execFileSync) };
});

describe('runtime adapters', () => {
  it('should enable the gVisor forwarding API only for an explicit ports workload', () => {
    const adapter = new RunscRuntimeAdapter();
    const input = { tenantId: 'immo', sandboxUid: 'network', mounts: [], overlayUpper: '/tmp/upper',
      overlayWork: '/tmp/work', quotaMiB: 704, uid: 1000, gid: 1000 };
    // release-20261102.0 Loader.portForward rejects NetworkNone; NetworkSandbox
    // uses the OCI private network namespace (loopback only, no supplied path).
    expect(adapter.runscArgs({ ...input, network: 'ports' })).toContain('--network=sandbox');
    expect(adapter.runscArgs({ ...input, network: 'none' })).toContain('--network=none');
    expect(adapter.runscArgs(input)).toContain('--network=none');
  });
  it('should create and configure a fresh loopback namespace before executing a ports sandbox', async () => {
    const adapter = new RunscRuntimeAdapter('runsc', { prepare: () => ({ path: '/tmp', workspace: '/tmp/w', output: '/tmp/o', mounted: [] }), destroy() {} });
    vi.spyOn(adapter, 'hasRunsc').mockReturnValue(true);
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter(); queueMicrotask(() => child.emit('error', new Error('stop after recording argv')));
      return child as ReturnType<typeof spawn>;
    });
    try {
      await expect(adapter.runSandbox({ tenantId: 'immo', sandboxUid: 'private', mounts: [], overlayUpper: '/tmp/upper',
        overlayWork: '/tmp/work', quotaMiB: 704, uid: 1000, gid: 1000, network: 'ports' })).rejects.toThrow();
      const args = vi.mocked(spawn).mock.calls[0]![1] as string[];
      const offset = args.indexOf('unshare');
      expect(offset).toBeGreaterThan(0);
      expect(args.slice(offset, offset + 9)).toEqual(['unshare', '--net', '--', 'sh', '-ec',
        privateNetworkScript, 'sandbox-network', 'runsc', '--root=/run/execution-node/runsc']);
      expect(args).toContain('--network=sandbox');
    } finally { vi.restoreAllMocks(); }
  });
  it('should hard-bound the runtime version subprocess', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('version timeout'); });
    try {
      expect(new RunscRuntimeAdapter().hasRunsc()).toBe(false);
      expect(execFileSync).toHaveBeenCalledWith('runsc', ['--version'], { stdio: 'ignore', timeout: 1000, killSignal: 'SIGKILL' });
    } finally { vi.restoreAllMocks(); }
  });
  it('should tolerate a launcher exit delivered after bundle destruction', async () => {
    const child = new EventEmitter();
    const adapter = new RunscRuntimeAdapter('runsc', { prepare: () => ({ path: '/tmp', workspace: '/tmp/w', output: '/tmp/o', mounted: [] }), destroy() {} });
    vi.spyOn(adapter, 'hasRunsc').mockReturnValue(true); vi.spyOn(adapter, 'stopSandbox').mockResolvedValue(true);
    vi.mocked(execFileSync).mockImplementation((_file, args) => args?.includes('state') ? '{"status":"running"}' : args?.includes('list') ? '[]' : '');
    vi.mocked(spawn).mockImplementation(() => { queueMicrotask(() => child.emit('spawn')); return child as ReturnType<typeof spawn>; });
    try {
      const { runtimeId } = await adapter.runSandbox({ tenantId: 'immo', sandboxUid: 'delayed-exit', mounts: [],
        overlayUpper: '/tmp/upper', overlayWork: '/tmp/work', quotaMiB: 704, uid: 1000, gid: 1000 });
      await adapter.destroySandbox(runtimeId);
      expect(() => child.emit('exit', 0, null)).not.toThrow();
    } finally { vi.restoreAllMocks(); }
  });
  it.each(['inactive', 'failed'])('should refuse forwarding when a running container has a %s scope', async active => {
    const adapter = new RunscRuntimeAdapter('runsc', { prepare: () => ({ path: '/tmp', workspace: '/tmp/w', output: '/tmp/o', mounted: [] }), destroy() {} });
    vi.spyOn(adapter, 'hasRunsc').mockReturnValue(true);
    vi.mocked(execFileSync).mockImplementation(file => file === 'runsc' ? '{"status":"running"}' : active);
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter(); queueMicrotask(() => child.emit('spawn'));
      return child as ReturnType<typeof spawn>;
    });
    try {
      const { runtimeId } = await adapter.runSandbox({ tenantId: 'immo', sandboxUid: 'scope', mounts: [],
        overlayUpper: '/tmp/upper', overlayWork: '/tmp/work', quotaMiB: 704, uid: 1000, gid: 1000 });
      expect(() => adapter.assertRunning(runtimeId)).toThrow('scope exited');
      await expect(adapter.portTarget(runtimeId, 5173)).rejects.toThrow('scope exited');
    } finally { vi.restoreAllMocks(); }
  });
  it.each(['null', '[]', '{}', 'garbage'])('should normalize empty cleanup inventory and reject garbage (%s)', async inventory => {
    const destroy = vi.fn();
    const adapter = new RunscRuntimeAdapter('runsc', { prepare: () => ({ path: '/tmp', workspace: '/tmp/w', output: '/tmp/o', mounted: [] }), destroy });
    vi.spyOn(adapter, 'hasRunsc').mockReturnValue(true);
    vi.mocked(execFileSync).mockImplementation((file, args) => {
      if (file === 'runsc') return inventory;
      if (args?.includes('--property=ControlGroup')) return '';
      if (args?.includes('--property=ActiveState')) return 'inactive';
      if (args?.[0] === 'stop') return '';
      throw new Error('scope collected');
    });
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter(); queueMicrotask(() => { child.emit('spawn'); child.emit('exit', 0, null); });
      return child as ReturnType<typeof spawn>;
    });
    try {
      const { runtimeId } = await adapter.runSandbox({ tenantId: 'immo', sandboxUid: 'inventory', mounts: [],
        overlayUpper: '/tmp/upper', overlayWork: '/tmp/work', quotaMiB: 704, uid: 1000, gid: 1000 });
      vi.spyOn(adapter, 'stopSandbox').mockResolvedValue(true);
      if (['null', '[]'].includes(inventory)) {
        await adapter.destroySandbox(runtimeId); expect(destroy).toHaveBeenCalledOnce();
      } else { await expect(adapter.destroySandbox(runtimeId)).rejects.toThrow(); expect(destroy).not.toHaveBeenCalled(); }
    } finally { vi.restoreAllMocks(); }
  });
  it('should map UNKNOWN/-122 launcher failures to quota errors with a cleanup identity', async () => {
    const adapter = new RunscRuntimeAdapter('runsc', { prepare: () => ({ path: '/tmp', workspace: '/tmp/w', output: '/tmp/o', mounted: [] }), destroy: () => {} });
    vi.spyOn(adapter, 'hasRunsc').mockReturnValue(true);
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('error', Object.assign(new Error('UNKNOWN'), { code: 'UNKNOWN', errno: -122 })));
      return child as ReturnType<typeof spawn>;
    });
    try {
      await expect(adapter.runSandbox({ tenantId: 'immo', sandboxUid: 'quota', mounts: [],
        overlayUpper: '/tmp/upper', overlayWork: '/tmp/work', quotaMiB: 704, uid: 1000, gid: 1000 }))
        .rejects.toMatchObject({ code: 'tenant_quota_exceeded', runtimeId: 'runsc-immo-quota' });
    } finally { vi.restoreAllMocks(); }
  });
  it.each(['delete', 'expiry'])('should release capacity after exit and collected scope cleanup (%s)', async mode => {
    vi.useFakeTimers();
    const destroy = vi.fn();
    let scopeState = 'inactive';
    const adapter = new RunscRuntimeAdapter('runsc', { prepare: () => ({ path: '/tmp', workspace: '/tmp/w', output: '/tmp/o', mounted: [] }), destroy });
    vi.spyOn(adapter, 'hasRunsc').mockReturnValue(true);
    vi.spyOn(adapter, 'exportOutput').mockResolvedValue(Buffer.from('archive'));
    vi.mocked(execFileSync).mockImplementation((file, args) => {
      if (file === 'runsc') return '[]';
      if (args?.[0] === 'stop') throw new Error('Unit not loaded');
      if (args?.includes('--property=ControlGroup')) return scopeState === 'active' ? '/live-scope' : '';
      if (args?.includes('--property=ActiveState')) {
        if (scopeState === 'unknown') throw new Error('systemd unavailable');
        return scopeState;
      }
      throw new Error('unexpected system call');
    });
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => { child.emit('spawn'); child.emit('exit', 0, null); });
      return child as ReturnType<typeof spawn>;
    });
    const node = createExecutionNode();
    const daemon = new ExecutionNodeDaemon({ ...node, adapter, nodeId: 'node', nodeInstanceId: 'instance', nodeEpoch: 1 });
    const devScope = { kind: 'ui' as const, writable: ['ui/**'], refused: [], source: { repo: 'test', path: 'registry.ts', commit: 'abc' } };
    const input = { commandId: 'create', ownership: { tenantId: 'immo' as const, poolOwned: false as const,
      workspaceId: 'w', principalId: 'u', attemptId: 'a', purpose: 'build', generation: 1, custodyEpoch: 1 },
      spec: { tenantId: 'immo' as const, profile: 'artifact-build', devScope, command: ['/bin/true'], baseMounts: [], quotaMiB: 512, quotaInodes: 1000, uid: 1000, gid: 1000,
        physicalUid: 'collected', runtimeClass: 'gvisor' as const, network: 'none' as const, allowExec: true, allowPty: false, allowSnapshots: false } };
    try {
      const box = await daemon.createSandbox(input);
      await daemon.promoteToRunning('immo', box.id, { commandId: 'start', devScope, uid: 1000, gid: 1000, quotaMiB: 1536 });
      await vi.advanceTimersByTimeAsync(0);
      expect(box.state).toBe('stopped-output-retained');
      expect(node.admission.reservedMiB('immo')).toBe(1536);
      await daemon.exportArtifacts('immo', box.id, { commandId: 'export', devScope, spec: { subPath: 'ui/dist', buildId: 'b', maxBytes: 1000, destination: 'https://example.test' } });
      if (mode === 'delete') for (scopeState of ['active', 'unknown']) {
        await expect(daemon.deleteSandbox('immo', box.id, { commandId: `unsafe-${scopeState}`, devScope })).rejects.toThrow();
        expect(destroy).not.toHaveBeenCalled();
        expect(node.admission.reservedMiB('immo')).toBe(1536);
      }
      scopeState = 'inactive';
      if (mode === 'delete') await daemon.deleteSandbox('immo', box.id, { commandId: 'delete', devScope });
      else await vi.advanceTimersByTimeAsync(300_000);
      expect(box.state).toBe('destroyed');
      expect(destroy).toHaveBeenCalledOnce();
      expect(node.admission.reservedMiB('immo')).toBe(0);
      await expect(daemon.createSandbox({ ...input, commandId: 'next' })).resolves.toBeDefined();
    } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
  });
  it('should retain a successful exit before the first runsc running observation', async () => {
    const adapter = new RunscRuntimeAdapter('runsc', { prepare: () => ({ path: '/tmp', workspace: '/tmp/w', output: '/tmp/o', mounted: [] }), destroy: () => {} });
    vi.spyOn(adapter, 'hasRunsc').mockReturnValue(true);
    const onExit = vi.fn();
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('no running state observed'); });
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => { child.emit('spawn'); child.emit('exit', 0, null); });
      return child as ReturnType<typeof spawn>;
    });
    try {
      await expect(adapter.runSandbox({ tenantId: 'immo', sandboxUid: 'fast-success', mounts: [],
        overlayUpper: '/tmp/upper', overlayWork: '/tmp/work', quotaMiB: 1536, uid: 1000, gid: 1000, onExit }))
        .resolves.toEqual({ runtimeId: 'runsc-immo-fast-success' });
      expect(onExit).toHaveBeenCalledExactlyOnceWith(0);
      expect(() => adapter.assertRunning('runsc-immo-fast-success')).toThrow('exited');
      await expect(adapter.portTarget('runsc-immo-fast-success', 5173)).rejects.toThrow('exited');
      // Successful termination still requires an independent scope-quiescence confirmation.
      await expect(adapter.exportOutput('runsc-immo-fast-success', 'ui/dist')).rejects.toThrow('sandbox_not_quiesced');
    } finally { vi.restoreAllMocks(); }
  });
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
