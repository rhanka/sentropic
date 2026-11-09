import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { INSTALL_RECIPE, NPM_RELAY } from '../../../src/services/artifacts/live/recipes';
import type { DependencyFile } from '../../../src/services/artifacts/live/cache';
import { fakePod, refuse, runtime, stream } from './supervisor-pod';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const tgz = Buffer.from('package tarball');
const pin = { path: 'node_modules/vite', url: 'https://registry.npmjs.org/vite/-/vite-1.0.0.tgz', version: '1.0.0',
  integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}` };
const inputs = (bytes = tgz) => ({ lockfile: Buffer.from('{"lockfileVersion":3}'), identity: {} as never, recipe: INSTALL_RECIPE,
  stagingRef: 'ref-h', runtime, tarballs: stream([{ pin, bytes }]), sink: vi.fn(async (_file: DependencyFile) => undefined) });
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
    const failed = fakePod({ ...exported, install: () => ({ exitCode: 1 }) });
    await expect(failed.supervisor.cleanInstall(inputs())).rejects.toMatchObject({ code: 'builder_unavailable' });
    expect(failed.ops()).not.toContain('snapshot');
  });
  it('should refuse an exported tree with special files as an invalid dependency cache', async () => {
    const special = fakePod({ snapshot: () => ({ next: null, entries: [{ path: 'node_modules/x', type: 'other', mode: 0, size: 0, offset: 0, data: '' }] }) });
    await expect(special.supervisor.cleanInstall(inputs())).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
  });
});
