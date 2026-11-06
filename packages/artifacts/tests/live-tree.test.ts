import { expect, it } from 'vitest';
import { liveTreeSha } from '../src/server/live-tree.js';
import { liveWitness } from './fixtures/live-world.js';

const target = { storageScopeId: 'scope-a', repoId: 'repo', branch: 'artifact/alice/demo',
  subPath: '', principalId: 'alice', outputDir: 'dist' };
it('should match native git mktree vectors and preserve executable mode', () => {
  const empty = { treeSha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', entries: [] };
  // Native git mktree --missing: blob "hello", filename "a", modes 100644 / 100755.
  expect(liveTreeSha(empty, [{ path: 'a', text: 'hello', mode: '100644' }], target))
    .toBe('8917ce3833750c0f424a16966ef3391aafe880c1');
  expect(liveTreeSha(empty, [{ path: 'a', text: 'hello', mode: '100755' }], target))
    .toBe('e50a5082d9e592def1580bed8b7d621937f39cae');
});
it('should preserve excluded base entries, links and empty trees without reading their bytes', () => {
  const empty = { treeSha: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', entries: [] };
  const entries = [{ path: '.env', sha: 'a'.repeat(40), type: 'blob' as const, mode: '100644' },
    { path: 'binary', sha: 'b'.repeat(40), type: 'blob' as const, mode: '100644' },
    { path: 'alias', sha: 'c'.repeat(40), type: 'blob' as const, mode: '120000' },
    { path: 'empty', sha: empty.treeSha, type: 'tree' as const, mode: '040000' }];
  const tree = liveTreeSha({ ...empty, entries }, [], target);
  for (let i = 0; i < entries.length; i++) {
    expect(liveTreeSha({ ...empty, entries: entries.filter((_, index) => index !== i) }, [], target)).not.toBe(tree);
  }
});
it('should check durable principal quota before reading the forge for a commit', async () => {
  const w = liveWitness(); await w.write({ files: [{ path: 'ui/a.ts', text: 'changed' }] });
  const state = await w.status();
  const identity = { storageScopeId: w.binding.storageScopeId, artifactId: w.binding.artifactId, bindingGeneration: 1 };
  for (let i = 0; i < 30; i++) await w.store.transaction(identity, tx => tx.reserveCommit('alice', 'quota-' + i, new Date().toISOString()));
  w.git.resolveRef.mockClear();
  await expect(w.call('git_commit', { expectedHeadSha: state.currentHeadSha, message: 'Quota',
    idempotencyKey: 'quota-overflow', files: [{ path: 'ui/a.ts', text: 'changed' }] })).rejects.toMatchObject({ kind: 'limit_exceeded' });
  expect(w.git.resolveRef).not.toHaveBeenCalled(); expect(w.git.commit).not.toHaveBeenCalled();
});
