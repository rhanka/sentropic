import { chmod, lstat, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { b64, fence, harness } from './bootstrap-harness';

const file = (path: string, content = 'x', mode = 0o644) => ({ path, mode, contentBase64: b64(content) });

describe('pod bootstrap agent: closed protocol and source staging', () => {
  it('should refuse unknown operations, unknown fields and malformed requests', async () => {
    const pod = await harness();
    await expect(pod.send('exec')).rejects.toThrow('unknown_operation');
    await expect(pod.send('terminate', { cmd: 'sh' })).rejects.toThrow('unknown_field');
    await expect(pod.agent.handle({ id: 'a', seq: 1, fence: fence(), op: 'terminate', args: {}, shell: true }))
      .rejects.toThrow('unknown_field');
    await expect(pod.send('terminate', {}, { ...fence(), extra: 1 } as any)).rejects.toThrow('unknown_field');
  });

  it('should refuse an older or forked fence and accept an equal or newer one', async () => {
    const pod = await harness();
    await pod.send('terminate', {}, fence(5));
    await expect(pod.send('terminate', {}, fence(4))).rejects.toMatchObject({ code: 'fenced' });
    await expect(pod.send('terminate', {}, fence(5, 1, 's2'))).rejects.toMatchObject({ code: 'fenced' });
    await pod.send('terminate', {}, fence(5));
    await pod.send('terminate', {}, fence(1, 2, 's2'));
    await expect(pod.send('terminate', {}, fence(9, 1, 's1'))).rejects.toMatchObject({ code: 'fenced' });
    await pod.send('terminate', {}, fence(0, 0, 's3', 2));
  });

  it('should stage confined source paths write-once with a deterministic digest', async () => {
    const pod = await harness(); const twin = await harness();
    const batch = [file('package.json', '{}'), file('ui/bin/run.sh', '#!x', 0o755)];
    const staged = await pod.send('stage', { files: batch });
    expect(staged.files).toBe(2);
    expect(staged.stagedDigest).toMatch(/^[a-f0-9]{64}$/);
    expect((await twin.send('stage', { files: [...batch].reverse() })).stagedDigest).toBe(staged.stagedDigest);
    expect(await readFile(pod.path('workspace/ui/bin/run.sh'), 'utf8')).toBe('#!x');
    expect((await stat(pod.path('workspace/ui/bin/run.sh'))).mode & 0o777).toBe(0o755);
    for (const path of ['../x', '/etc/x', 'a/../../x', '.git/config', 'a/.git/x', 'a\\b', 'a\0b', 'a//b',
      'node_modules/x', 'ui/.npmrc', '.yarnrc.yml']) {
      await expect(pod.send('stage', { files: [file(path)] })).rejects.toThrow('invalid_path');
    }
    await expect(pod.send('stage', { files: [file('package.json')] })).rejects.toThrow('duplicate_path');
    await expect(pod.send('stage', { files: [file('d'), file('d')] })).rejects.toThrow('duplicate_path');
    await expect(pod.send('stage', { files: [file('e', 'x', 0o777)] })).rejects.toThrow('invalid_mode');
    await expect(pod.send('stage', { files: [{ path: 'f', mode: 0o644, contentBase64: '@@' }] })).rejects.toThrow('invalid_encoding');
    await expect(pod.send('stage', { files: [file('ok.ts'), file('../bad')] })).rejects.toThrow('invalid_path');
    expect(await readdir(pod.path('workspace'))).toEqual(['package.json', 'ui']);
  });

  it('should write host files only at their fixed paths', async () => {
    const pod = await harness();
    await expect(pod.send('hostFile', { path: '/tmp/other.mjs', source: 'x' })).rejects.toThrow('invalid_path');
    await pod.send('hostFile', { path: '/tmp/artifact-vite.config.mjs', source: 'export default {}' });
    await pod.send('hostFile', { path: '/tmp/artifact-vite.config.mjs', source: 'export default {a:1}' });
    expect(await readFile(pod.path('tmp/artifact-vite.config.mjs'), 'utf8')).toBe('export default {a:1}');
    await expect(pod.send('hostFile', { path: '/tmp/host-npmrc', source: 'x'.repeat(65537) })).rejects.toThrow('limit_exceeded');
  });

  it('should apply an admitted overlay atomically, keep modes and refuse links', async () => {
    const pod = await harness();
    await pod.send('stage', { files: [file('ui/a.ts', 'base', 0o755), file('ui/old.ts')] });
    expect(await pod.send('overlay', { revision: 'r2', files: [
      { path: 'ui/a.ts', contentBase64: b64('edit') }, { path: 'ui/new.ts', contentBase64: b64('new') }],
    deletes: ['ui/old.ts'] })).toEqual({ revision: 'r2' });
    expect(await readFile(pod.path('workspace/ui/a.ts'), 'utf8')).toBe('edit');
    expect((await stat(pod.path('workspace/ui/a.ts'))).mode & 0o777).toBe(0o755);
    expect((await stat(pod.path('workspace/ui/new.ts'))).mode & 0o777).toBe(0o644);
    await expect(lstat(pod.path('workspace/ui/old.ts'))).rejects.toThrow('ENOENT');
    await symlink('/etc/passwd', pod.path('workspace/ui/link.ts'));
    await symlink('/etc', pod.path('workspace/evil'));
    const write = (path: string) => ({ revision: 'r3', files: [{ path, contentBase64: b64('x') }], deletes: [] });
    await expect(pod.send('overlay', write('ui/link.ts'))).rejects.toThrow('invalid_path');
    await expect(pod.send('overlay', write('evil/x.ts'))).rejects.toThrow('invalid_path');
    await expect(pod.send('overlay', { ...write('ui/b.ts'), revision: 'bad rev' })).rejects.toThrow('invalid_revision');
  });

  it('should clear exactly the three writable roots, read-only trees included, after killing every process', async () => {
    let alive = [7, 8];
    const pod = await harness({ processes: { list: async () => alive, kill: (pid: number) => { alive = alive.filter(p => p !== pid); } } });
    await mkdir(pod.path('dependencies/node_modules/x'), { recursive: true });
    await writeFile(pod.path('dependencies/node_modules/x/i.js'), '1');
    await chmod(pod.path('dependencies/node_modules/x/i.js'), 0o444);
    await chmod(pod.path('dependencies/node_modules/x'), 0o555);
    await writeFile(pod.path('tmp/residue'), '1');
    await pod.send('stage', { files: [file('a.ts')] });
    await expect(pod.send('clear', { paths: ['/workspace', '/tmp'] })).rejects.toThrow('invalid_path');
    await expect(pod.send('clear', { paths: ['/workspace', '/dependencies', '/etc'] })).rejects.toThrow('invalid_path');
    await pod.send('clear', { paths: ['/tmp', '/workspace', '/dependencies'] });
    expect(alive).toEqual([]);
    for (const dir of ['workspace', 'dependencies', 'tmp']) expect(await readdir(pod.path(dir))).toEqual([]);
    await pod.send('stage', { files: [file('a.ts')] });
  });

  it('should report a surviving process tree instead of claiming termination', async () => {
    const pod = await harness({ processes: { list: async () => [9], kill: () => undefined } });
    await expect(pod.send('terminate')).rejects.toThrow('tree_survived');
    const clean = await harness();
    expect(await clean.send('terminate')).toEqual({ treeGone: true });
  });
});
