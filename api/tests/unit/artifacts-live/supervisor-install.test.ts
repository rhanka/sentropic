import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { INSTALL_RECIPE, NPM_RELAY } from '../../../src/services/artifacts/live/recipes';
import { fakePod, refuse, runtime } from './supervisor-pod';

const tgz = Buffer.from('package tarball');
const pin = { path: 'node_modules/vite', url: 'https://registry.npmjs.org/vite/-/vite-1.0.0.tgz', version: '1.0.0',
  integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}` };
const input = { lockfile: Buffer.from('{"lockfileVersion":3}'), identity: {} as never, recipe: INSTALL_RECIPE,
  stagingRef: 'ref-h', runtime, tarballs: [{ pin, bytes: tgz }] };
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
    const result = await pod.supervisor.cleanInstall(input);
    expect(pod.ops()).toEqual(['clear', 'put', 'put', 'install', 'snapshot', 'clear']);
    const install = pod.bodies[3].args;
    expect(install).toMatchObject({ recipe: 'install', runId: result.runId,
      tarballs: [{ path: '0.tgz', integrity: pin.integrity }] });
    expect(pod.received(String((install.cache as { transfer: string }).transfer))).toEqual([expect.objectContaining({ path: '0.tgz' })]);
    expect(JSON.stringify(pod.bodies)).not.toContain(NPM_RELAY);
    expect(JSON.stringify(pod.bodies)).not.toContain(pin.url);
    expect(result.files).toEqual([
      { path: 'node_modules/vite/bin/vite.js', type: 'file', mode: 365, bytes: Buffer.from('#!').toString('base64') },
      { path: 'node_modules/vite/package.json', type: 'file', mode: 292, bytes: Buffer.from('{}').toString('base64') },
    ]);
  });
  it('should refuse before sending without a leased runtime, with another recipe or with altered tarball bytes', async () => {
    const pod = fakePod(exported);
    await expect(pod.supervisor.cleanInstall({ ...input, runtime: undefined })).rejects.toMatchObject({ code: 'builder_unavailable' });
    await expect(pod.supervisor.cleanInstall({ ...input, recipe: { ...INSTALL_RECIPE, args: ['ci'] } as never }))
      .rejects.toMatchObject({ code: 'builder_unavailable' });
    await expect(pod.supervisor.cleanInstall({ ...input, tarballs: [{ pin, bytes: Buffer.from('other') }] }))
      .rejects.toMatchObject({ code: 'dependency_integrity_mismatch' });
    await expect(pod.supervisor.cleanInstall({ ...input, lockfile: Buffer.from('{}') })).rejects.toMatchObject({ code: 'builder_unavailable' });
    expect(pod.channel.send).not.toHaveBeenCalled();
  });
  it('should fail closed on a missing staged tarball or a failed install, never falling back to the network', async () => {
    const missing = fakePod({ ...exported, install: () => refuse('integrity') });
    await expect(missing.supervisor.cleanInstall(input)).rejects.toMatchObject({ code: 'dependency_integrity_missing' });
    const failed = fakePod({ ...exported, install: () => ({ exitCode: 1 }) });
    await expect(failed.supervisor.cleanInstall(input)).rejects.toMatchObject({ code: 'builder_unavailable' });
    expect(failed.ops()).not.toContain('snapshot');
  });
  it('should refuse an exported tree with special files as an invalid dependency cache', async () => {
    const special = fakePod({ snapshot: () => ({ next: null, entries: [{ path: 'node_modules/x', type: 'other', mode: 0, size: 0, offset: 0, data: '' }] }) });
    await expect(special.supervisor.cleanInstall(input)).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
  });
});
