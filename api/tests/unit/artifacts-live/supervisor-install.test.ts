import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { INSTALL_RECIPE, NPM_RELAY } from '../../../src/services/artifacts/live/recipes';
import type { DependencyFile } from '../../../src/services/artifacts/live/cache';
import { createCleanInstall } from '../../../src/services/artifacts/live/supervisor-install';
import type { InstallStepFields } from '../../../src/services/artifacts/live/deadline';
import { fakePod, refuse, runtime, stream, text } from './supervisor-pod';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const tgz = Buffer.from('package tarball');
const pin = { path: 'node_modules/vite', url: 'https://registry.npmjs.org/vite/-/vite-1.0.0.tgz', version: '1.0.0',
  integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}` };
const inputs = (bytes = tgz) => ({ lockfile: Buffer.from('{"lockfileVersion":3}'), identity: {} as never, recipe: INSTALL_RECIPE,
  stagingRef: 'ref-h', runtime, tarballs: stream([{ pin, bytes }]), sink: vi.fn(async (_file: DependencyFile) => undefined) });
const scopedInputs = () => ({ lockfile: Buffer.from('{"lockfileVersion":3}'),
  identity: { installWorkspaces: ['ui'] } as never, recipe: { ...INSTALL_RECIPE, args: [...INSTALL_RECIPE.args, '--workspace=ui'] } as never,
  stagingRef: 'ref-h', runtime, tarballs: stream([{ pin, bytes: tgz }]), sink: vi.fn(async (_file: DependencyFile) => undefined) });
const exported = { snapshot: () => ({ next: null, entries: [
  { path: 'node_modules/vite/bin/vite.js', type: 'file', mode: 0o755, size: 2, offset: 0, data: Buffer.from('#!').toString('base64') },
  { path: 'node_modules/.bin/vite', type: 'symlink', mode: 0o777, size: 0, offset: 0, data: '' },
  { path: 'node_modules/vite/package.json', type: 'file', mode: 0o644, size: 2, offset: 0, data: Buffer.from('{}').toString('base64') },
] }) };

describe('supervisor offline clean install', () => {
  it('should install offline with scripts disabled and never name the relay (W2 §2)', () => {
    expect(INSTALL_RECIPE.args).toEqual(expect.arrayContaining(['ci', '--offline', '--ignore-scripts']));
    expect(INSTALL_RECIPE.args.join(' ')).not.toMatch(/--registry|npm-relay/);
  });
  it('should stage source and verified tarballs, install by name and export only regular dependency files', async () => {
    const pod = fakePod(exported);
    const input = inputs();
    const result = await pod.supervisor.cleanInstall(input);
    expect(pod.ops()).toEqual(['clear', 'put', 'put', 'install', 'snapshot', 'clear']);
    const install = pod.bodies[3].args;
    expect(install).toMatchObject({ recipe: 'install', runId: result.runId,
      tarballs: [{ path: '0.tgz', integrity: pin.integrity }] });
    expect(pod.received(String((install.cache as { transfer: string }).transfer))).toEqual([expect.objectContaining({ path: '0.tgz' })]);
    expect(JSON.stringify(pod.bodies)).not.toContain(NPM_RELAY);
    expect(JSON.stringify(pod.bodies)).not.toContain(pin.url);
    expect(result).toEqual({ runId: result.runId });
    expect(input.sink.mock.calls.map(([file]) => file)).toEqual([
      { path: 'node_modules/vite/bin/vite.js', mode: 365, bytes: Buffer.from('#!') },
      { path: 'node_modules/vite/package.json', mode: 292, bytes: Buffer.from('{}') },
    ]);
  });
  it('should refuse before sending without a leased runtime or with another recipe or lockfile', async () => {
    const pod = fakePod(exported);
    await expect(pod.supervisor.cleanInstall({ ...inputs(), runtime: undefined })).rejects.toMatchObject({ code: 'builder_unavailable' });
    await expect(pod.supervisor.cleanInstall({ ...inputs(), recipe: { ...INSTALL_RECIPE, args: ['ci'] } as never }))
      .rejects.toMatchObject({ code: 'builder_unavailable' });
    await expect(pod.supervisor.cleanInstall({ ...inputs(), lockfile: Buffer.from('{}') })).rejects.toMatchObject({ code: 'builder_unavailable' });
    expect(pod.channel.send).not.toHaveBeenCalled();
  });
  it('should stream verified tarballs and never run the install after altered tarball bytes', async () => {
    const pod = fakePod(exported);
    await expect(pod.supervisor.cleanInstall(inputs(Buffer.from('other')))).rejects.toMatchObject({ code: 'dependency_integrity_mismatch' });
    expect(pod.ops()).not.toContain('install');
  });
  it('should report progress per frame and suspend the stall across the offline install', async () => {
    const pod = fakePod(exported);
    const progress = { report: vi.fn(), suspendStall: vi.fn() };
    await pod.supervisor.cleanInstall({ ...inputs(), progress });
    // Source transfer frames, staged tarball frames and drained files all report; the opaque `npm ci` suspends.
    expect(progress.report.mock.calls.length).toBeGreaterThan(3);
    expect(progress.suspendStall).toHaveBeenNthCalledWith(1, true);
    expect(progress.suspendStall).toHaveBeenNthCalledWith(2, false);
  });
  it('should stop a pre-aborted install before sending any frame', async () => {
    const pod = fakePod(exported);
    const controller = new AbortController(); controller.abort();
    await expect(pod.supervisor.cleanInstall({ ...inputs(), signal: controller.signal })).rejects.toThrow();
    expect(pod.channel.send).not.toHaveBeenCalled();
  });
  it('should abort a cut install mid-drain and send no further frames', async () => {
    const pod = fakePod(exported);
    const controller = new AbortController();
    const sent = () => pod.channel.send.mock.calls.length;
    const input = { ...inputs(), signal: controller.signal,
      sink: vi.fn(async (_file: DependencyFile) => { controller.abort(); }) };
    await expect(pod.supervisor.cleanInstall(input))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'supervisor_channel_aborted' });
    const cut = sent();
    await delay(60);
    expect(sent()).toBe(cut);
  });
  it('should fail closed on a missing staged tarball or a failed install, never falling back to the network', async () => {
    const missing = fakePod({ ...exported, install: () => refuse('integrity') });
    await expect(missing.supervisor.cleanInstall(inputs())).rejects.toMatchObject({ code: 'dependency_integrity_missing' });
    const failed = fakePod({ ...exported, install: () => ({ exitCode: 1, signal: null, output: '' }) });
    await expect(failed.supervisor.cleanInstall(inputs())).rejects.toMatchObject({ code: 'builder_unavailable',
      reason: 'install_failed:exit_1', detail: undefined });
    expect(failed.ops()).not.toContain('snapshot');
  });

  it('should classify a failed install into the job reason: disk, cache, memory, signal or plain exit', async () => {
    const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');
    const classified = async (install: Record<string, unknown>) => {
      const pod = fakePod({ ...exported, install: () => install });
      const failure = await pod.supervisor.cleanInstall(inputs()).then(() => undefined, error => error) as {
        code?: string; reason?: string; detail?: string };
      expect(failure.code).toBe('builder_unavailable');
      return failure;
    };
    expect((await classified({ exitCode: 1, signal: null, output: b64('npm error code ENOSPC') })).reason)
      .toBe('install_failed:enospc');
    expect((await classified({ exitCode: 1, signal: null, output: b64("cache mode is 'only-if-cached'") })).reason)
      .toBe('install_failed:enotcached');
    expect((await classified({ exitCode: 137, signal: null, output: '' })).reason).toBe('install_failed:oom');
    expect((await classified({ exitCode: null, signal: 'SIGKILL', output: '' })).reason).toBe('install_failed:oom');
    expect((await classified({ exitCode: null, signal: 'SIGTERM', output: '' })).reason).toBe('install_failed:signal_SIGTERM');
    expect((await classified({ exitCode: 2, signal: null, output: b64('npm error boom') })).reason).toBe('install_failed:exit_2');
  });

  it('should refuse a malformed install reply without guessing a cause', async () => {
    const pod = fakePod({ ...exported, install: () => ({ exitCode: 'boom' }) });
    await expect(pod.supervisor.cleanInstall(inputs()))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'install_unconfirmed' });
    expect(pod.ops()).not.toContain('snapshot');
  });
  it('should refuse an exported tree with special files as an invalid dependency cache', async () => {
    const special = fakePod({ snapshot: () => ({ next: null, entries: [{ path: 'node_modules/x', type: 'other', mode: 0, size: 0, offset: 0, data: '' }] }) });
    await expect(special.supervisor.cleanInstall(inputs())).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
  });
  it('should forward the workspace selection to the pod with the scoped recipe', async () => {
    const pod = fakePod(exported);
    await expect(pod.supervisor.cleanInstall(scopedInputs())).resolves.toEqual(expect.objectContaining({ runId: expect.any(String) }));
    expect(pod.bodies[3].args).toMatchObject({ recipe: 'install', workspaces: ['ui'],
      tarballs: [{ path: '0.tgz', integrity: pin.integrity }] });
  });
  it('should refuse a scoped recipe that does not match the identity selection', async () => {
    const pod = fakePod(exported);
    await expect(pod.supervisor.cleanInstall({ ...scopedInputs(), recipe: INSTALL_RECIPE as never }))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'install_recipe_invalid' });
    expect(pod.ops()).not.toContain('install');
  });
  it('should log install sub-steps in order with counts, distinguishing pre and post clear', async () => {
    const lines: InstallStepFields[] = [];
    const core = {
      id: () => 'run-1',
      transfer: vi.fn(async () => ({ transfer: 'src' })),
      streamPipelined: vi.fn(async (_rt: unknown, _op: unknown, items: AsyncIterable<unknown>) => {
        for await (const _item of items);
        return { transfer: 'cache' };
      }),
      stream: vi.fn(async (_rt: unknown, _op: unknown, items: AsyncIterable<unknown>) => {
        for await (const _item of items);
        return { transfer: 'cache' };
      }),
      drain: vi.fn(async (_rt: unknown, _op: unknown, _limits: unknown, _mode: unknown, _failure: unknown,
        sink: (file: { path: string; mode: number; bytes: Uint8Array }) => Promise<void>) => {
        await sink({ path: 'pkg/index.js', mode: 0o644, bytes: Buffer.from('x') });
      }),
      call: vi.fn(async (_rt: unknown, op: string) =>
        op === 'clear' ? { cleared: ['/tmp'] } : { exitCode: 0, signal: null, output: '' }),
    };
    const cleanInstall = createCleanInstall(core as never,
      async () => [text('package-lock.json', '{"lockfileVersion":3}'), text('ui/main.ts', 'ok')],
      { log: fields => lines.push(fields) });
    await expect(cleanInstall(inputs())).resolves.toMatchObject({ runId: 'run-1' });
    expect(lines.map(line => line.step)).toEqual(['forge_redownload', 'clear', 'source_transfer', 'tarball_stream',
      'recipe', 'drain', 'cleanup']);
    expect(lines.every(line => line.msg === 'artifact_live_install_step' && line.outcome === 'ok')).toBe(true);
    expect(lines.find(line => line.step === 'forge_redownload')).toMatchObject({ files: 2 });
    expect(lines.find(line => line.step === 'source_transfer')).toMatchObject({ files: 2 });
    expect(lines.find(line => line.step === 'tarball_stream')).toMatchObject({ files: 1 });
    expect(lines.find(line => line.step === 'drain')).toMatchObject({ files: 1, bytes: 1 });
  });
  it('should log forge_redownload fail without running later sub-steps on a source hang', async () => {
    const lines: InstallStepFields[] = [];
    const controller = new AbortController();
    const core = {
      id: () => 'run-1',
      transfer: vi.fn(async () => ({ transfer: 'src' })),
      streamPipelined: vi.fn(async () => ({ transfer: 'cache' })),
      stream: vi.fn(async () => ({ transfer: 'cache' })),
      drain: vi.fn(async () => undefined),
      call: vi.fn(async () => ({ cleared: ['/tmp'] })),
    };
    const cleanInstall = createCleanInstall(core as never, () => new Promise<never>(() => {}),
      { log: fields => lines.push(fields) });
    const input = { ...inputs(), signal: controller.signal };
    const pending = cleanInstall(input);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'builder_unavailable' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ step: 'forge_redownload', outcome: 'fail' });
    expect(core.transfer).not.toHaveBeenCalled();
  });
});

describe('supervisor in-pod seal', () => {
  it('should stage only manifests, seal in-pod and fetch one archive (no drain)', async () => {
    const archive = Buffer.from('sealed-archive-bytes');
    const archiveSha256 = createHash('sha256').update(archive).digest('hex');
    const pod = fakePod({
      sealDependencies: () => ({ files: 1, bytes: 18, archiveBytes: archive.byteLength,
        archiveSha256, treeSha256: 'c'.repeat(64) }),
      sealFetch: () => ({ data: archive.toString('base64'), next: null, size: archive.byteLength }),
    });
    const input = { lockfile: Buffer.from('{"lockfileVersion":3}'), identity: {} as never,
      recipe: INSTALL_RECIPE, stagingRef: 'ref-h', runtime,
      tarballs: stream([{ pin, bytes: tgz }]) };
    const seal = (pod.supervisor as unknown as { sealInstall: (input: never) => Promise<unknown> }).sealInstall;
    const result = await seal(input as never) as { runId: string; archive: Uint8Array; treeSha256: string };
    expect(result.archive).toEqual(archive);
    expect(result.treeSha256).toBe('c'.repeat(64));
    expect(pod.ops()).toEqual(['clear', 'put', 'put', 'install', 'sealDependencies', 'sealFetch', 'clear']);
    expect(pod.ops()).not.toContain('snapshot');
    const manifestTransfer = String(pod.bodies[1]!.args.transfer);
    expect(pod.received(manifestTransfer).map(file => file.path)).toEqual(['package-lock.json']);
  });
});
