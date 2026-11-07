import { chmod, lstat, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { b64, file, harness, sha256, treeDigest } from './bootstrap-harness';

const HEAD = 'a'.repeat(40); const TREE = 'b'.repeat(40);
const stage = async (pod: Awaited<ReturnType<typeof harness>>, files: ReturnType<typeof file>[]) =>
  pod.send('stage', { ...await pod.transfer('workspace', files), headSha: HEAD, treeSha: TREE });
const overlay = async (pod: Awaited<ReturnType<typeof harness>>, files: ReturnType<typeof file>[], deletes: string[], revision: unknown = 'r2') =>
  pod.send('overlay', { ...await pod.transfer('overlay', files), deletes, revision, generation: 1, baseHeadSha: HEAD, treeSha: TREE });

describe('pod bootstrap agent: W3 transfers and source staging', () => {
  it('should refuse unknown operation fields and malformed put entries', async () => {
    const pod = await harness();
    await expect(pod.send('terminate', { cmd: 'sh' })).rejects.toThrow('failed:unknown_field');
    const put = (entry: Record<string, unknown>, target = 'workspace') => pod.send('put', { transfer: 't1', target, entries: [entry] });
    const ok = { path: 'a.ts', mode: 0o644, size: 1, offset: 0, data: b64('x') };
    await expect(put(ok, 'etc')).rejects.toThrow('failed:invalid_args');
    await expect(put({ ...ok, mode: 0o777 })).rejects.toThrow('failed:invalid_args');
    await expect(put({ ...ok, data: '@@' })).rejects.toThrow('failed:invalid_encoding');
    await expect(put({ ...ok, size: 0 })).rejects.toThrow('failed:invalid_args');
    await expect(put({ ...ok, offset: 1 })).rejects.toThrow('failed:invalid_args');
    await expect(put({ ...ok, path: '.artifact-transfer/x' })).rejects.toThrow('failed:invalid_path');
    await expect(put({ ...ok, size: 2 * 1024 * 1024 }, 'overlay')).rejects.toThrow('limit:limit_exceeded');
    await expect(pod.send('put', { transfer: 't1', target: 'workspace', entries: [] })).rejects.toThrow('failed:invalid_args');
  });

  it('should stage the committed tree only when the recomputed W3 tree digest matches', async () => {
    const pod = await harness();
    const files = [file('package.json', '{}'), file('ui/bin/run.sh', '#!x'.repeat(10), 0o755)];
    const sent = await pod.transfer('workspace', files, 7);
    await expect(pod.send('stage', { ...sent, treeDigest: sha256('other'), headSha: HEAD, treeSha: TREE }))
      .rejects.toThrow('failed:digest_mismatch');
    expect(await readdir(pod.path('workspace'))).toEqual([]);
    expect(await stage(pod, files)).toEqual({ treeDigest: sent.treeDigest });
    expect(await readFile(pod.path('workspace/ui/bin/run.sh'), 'utf8')).toBe('#!x'.repeat(10));
    expect((await stat(pod.path('workspace/ui/bin/run.sh'))).mode & 0o777).toBe(0o755);
    expect(await readdir(pod.path('workspace'))).toEqual(['package.json', 'ui']);
    await expect(stage(pod, [file('b.ts', 'x')])).rejects.toThrow('failed:already_staged');
  });

  it('should refuse unconfined, configuration, dependency and file/directory-conflicting source paths', async () => {
    for (const path of ['../x', '/etc/x', 'a/../../x', '.git/config', 'a/.git/x', 'a\\b', 'a//b', 'node_modules/x', 'ui/.npmrc', '.yarnrc.yml']) {
      const pod = await harness();
      await expect(stage(pod, [file(path, 'x')])).rejects.toThrow('failed:invalid_path');
      expect(await readdir(pod.path('workspace'))).toEqual([]);
    }
    const pod = await harness();
    await expect(stage(pod, [file('a', 'x'), file('a/b', 'y')])).rejects.toThrow('failed:invalid_path');
    await expect(pod.send('stage', { transfer: 'none', treeDigest: sha256('[]'), headSha: HEAD, treeSha: TREE }))
      .rejects.toThrow('failed:invalid_args');
  });

  it('should write host files only at their fixed paths and echo their sha256', async () => {
    const pod = await harness();
    await expect(pod.send('hostFile', { path: '/tmp/other.mjs', source: 'x' })).rejects.toThrow('failed:invalid_path');
    expect(await pod.send('hostFile', { path: '/tmp/artifact-vite.config.mjs', source: 'export default {}' }))
      .toEqual({ sha256: sha256('export default {}') });
    await pod.send('hostFile', { path: '/tmp/artifact-vite.config.mjs', source: 'export default {a:1}' });
    expect(await readFile(pod.path('tmp/artifact-vite.config.mjs'), 'utf8')).toBe('export default {a:1}');
    await expect(pod.send('hostFile', { path: '/tmp/host-npmrc', source: 'x'.repeat(65537) })).rejects.toThrow('limit:limit_exceeded');
  });

  it('should apply a draft overlay atomically with its revision and refuse links before any change', async () => {
    const pod = await harness();
    await stage(pod, [file('ui/a.ts', 'base'), file('ui/old.ts', 'old')]);
    const edits = [file('ui/a.ts', 'edit'), file('ui/new.ts', 'new')];
    expect(await overlay(pod, edits, ['ui/old.ts'])).toEqual({ revision: 'r2', treeDigest: treeDigest(edits) });
    expect(await readFile(pod.path('workspace/ui/a.ts'), 'utf8')).toBe('edit');
    await expect(lstat(pod.path('workspace/ui/old.ts'))).rejects.toThrow('ENOENT');
    await symlink('/etc/passwd', pod.path('workspace/ui/link.ts'));
    await symlink('/etc', pod.path('workspace/evil'));
    await expect(overlay(pod, [file('ui/a.ts', 'lost'), file('ui/link.ts', 'x')], [])).rejects.toThrow('failed:invalid_path');
    await expect(overlay(pod, [file('ui/a.ts', 'lost')], ['evil/x.ts'])).rejects.toThrow('failed:invalid_path');
    expect(await readFile(pod.path('workspace/ui/a.ts'), 'utf8')).toBe('edit');
    await expect(overlay(pod, [file('ui/b.ts', 'x')], [], 'bad rev')).rejects.toThrow('failed:invalid_revision');
    await expect(overlay(pod, [file('ui/b.ts', 'x')], ['ui/b.ts'])).rejects.toThrow('failed:duplicate_path');
    await expect(pod.send('overlay', { ...await pod.transfer('overlay', []), deletes: [], revision: 7, generation: 2,
      baseHeadSha: HEAD, treeSha: TREE })).rejects.toThrow('fenced:stale_fence');
    expect(await overlay(pod, [], ['ui/new.ts'], 8)).toMatchObject({ revision: 8 });
  });

  it('should clear the requested writable roots, read-only trees included, after killing every process', async () => {
    let alive = [7, 8];
    const pod = await harness({ processes: { list: async () => alive, killGroup: () => undefined,
      kill: (pid: number) => { alive = alive.filter(p => p !== pid); } } });
    await mkdir(pod.path('dependencies/node_modules/x'), { recursive: true });
    await writeFile(pod.path('dependencies/node_modules/x/i.js'), '1');
    await chmod(pod.path('dependencies/node_modules/x/i.js'), 0o444);
    await chmod(pod.path('dependencies/node_modules/x'), 0o555);
    await writeFile(pod.path('tmp/residue'), '1');
    await stage(pod, [file('a.ts', 'x')]);
    await expect(pod.send('clear', { paths: ['/workspace', '/etc'] })).rejects.toThrow('failed:invalid_path');
    await expect(pod.send('clear', { paths: ['/tmp', '/tmp'] })).rejects.toThrow('failed:invalid_path');
    expect(await pod.send('clear', { paths: ['/tmp'] })).toEqual({ cleared: ['/tmp'] });
    expect(alive).toEqual([]); expect(await readdir(pod.path('tmp'))).toEqual([]);
    expect(await pod.send('clear', { paths: ['/workspace', '/dependencies'] })).toEqual({ cleared: ['/workspace', '/dependencies'] });
    for (const dir of ['workspace', 'dependencies']) expect(await readdir(pod.path(dir))).toEqual([]);
    await stage(pod, [file('a.ts', 'x')]);
  });

  it('should kill every recipe process group and report a surviving tree instead of claiming termination', async () => {
    const groups: number[] = [];
    const pod = await harness({ processes: { list: async () => [9], kill: () => undefined, killGroup: (g: number) => { groups.push(g); } } });
    await expect(pod.send('terminate')).rejects.toThrow('failed:tree_survived');
    const clean = await harness();
    expect(await clean.send('terminate')).toEqual({ treeGone: true });
    expect(groups).toEqual([]);
  });
});
