import { describe, expect, it, vi } from 'vitest';
import { createLiveService } from '../src/server/live-service.js';
import { createMemoryLiveStore } from '../src/server/live-store.js';
import { gitBinding } from './fixtures/git-binding-conformance.js';

export function liveWitness() {
  let head = 'a'.repeat(40);
  let canReadCode = true;
  const binding = { ...gitBinding(), executor: 'sandbox' as const, personalPrincipalId: 'alice', headCommitSha: head };
  const baseFiles = new Map([['ui/a.ts', 'alpha'], ['ui/b.ts', 'beta']]);
  const git = {
    resolveRef: vi.fn(async () => head),
    inspectCommit: vi.fn(async () => ({ sha: head, treeSha: 'b'.repeat(40), parents: ['a'.repeat(40)], message: '',
      author: { name: 'Alice', email: 'alice@example.test' }, committer: { name: 'App', email: 'app@example.test' } })),
    snapshot: vi.fn(async () => ({ treeSha: 'b'.repeat(40), entries: [...baseFiles].map(([path]) =>
      ({ path, sha: 'd'.repeat(40), type: 'blob' as const, mode: '100644' })) })),
    read: vi.fn(async (_target, input) => ({ commitSha: input.commitSha, treeSha: 'b'.repeat(40),
      files: (input.paths ?? [...baseFiles.keys()]).map(path => ({ path, text: baseFiles.get(path)!, encoding: 'utf-8' as const })), nextCursor: null })),
    isAncestor: vi.fn(async () => true),
    commit: vi.fn(async input => { for (const f of input.files) { if (f.text === null) baseFiles.delete(f.path); else baseFiles.set(f.path, f.text); }
      head = 'c'.repeat(40); return { commitSha: head, treeSha: input.liveTreeSha ?? 'e'.repeat(40) }; }),
    createBranch: vi.fn(async () => undefined),
  };
  const worker = { reconcile: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
  const service = createLiveService({ store: createMemoryLiveStore(), git, worker,
    keys: { current: async () => ({ version: 'k1', key: Buffer.alloc(32, 3) }), resolve: async () => Buffer.alloc(32, 3) },
    authorize: async invocation => ({ binding, ownerId: 'alice', canReadCode, canWrite: true, humanLinked: true,
      qualified: true, target: { storageScopeId: binding.storageScopeId, repoId: binding.repoId, branch: binding.branch,
        subPath: '', principalId: invocation.actorId, outputDir: 'dist' },
      repository: { storageScopeId: binding.storageScopeId, repoId: binding.repoId, locator: '', installationRef: '',
        branchPrefix: 'artifact/' as const, allowedSubPaths: [''], canWrite: true, writablePaths: ['ui/**'], refusedWritePaths: [] } }) });
  const context = { actorId: 'alice', storageScopeId: binding.storageScopeId, invocationId: 'inv-1' };
  let sequence = 0;
  const call = async (op: string, args: Record<string, unknown> = {}) => service.execute(op,
    { artifactId: binding.artifactId, ...args }, { ...context, invocationId: 'inv-' + ++sequence });
  const status = () => call('live_status');
  const write = async (args: Record<string, unknown>) => {
    const state = await status();
    return call('live_write', { expectedHeadSha: head, expectedLiveRevision: state.liveRevision,
      idempotencyKey: 'write-' + ++sequence, ...args });
  };
  return { service, call, status, write, git, worker, binding, setHead: (sha: string) => { head = sha; },
    revoke: () => { canReadCode = false; } };
}
describe('A-LIVE authoritative tree', () => {
  it('should persist edits without committing and expose the complete commit recipe', async () => {
    const w = liveWitness();
    const written = await w.write({ files: [{ path: 'ui/a.ts', text: 'new text' }], deletes: ['ui/b.ts'] });
    expect(written.durableRevision).toBe(written.liveRevision);
    expect(written.appliedRevision).toBeNull();
    expect(w.git.commit).not.toHaveBeenCalled();
    const diff = await w.call('live_status', { includeDiff: true });
    expect(diff.files).toEqual([{ path: 'ui/a.ts', text: 'new text' }]);
    expect(diff.deletes).toEqual(['ui/b.ts']);
    expect((await w.call('live_read')).files).toEqual([{ path: 'ui/a.ts', text: 'new text', mode: '100644', encoding: 'utf-8' }]);
  });
  it('should reject duplicate/mixed paths and refused A1 paths before any forge call', async () => {
    const w = liveWitness(); await w.status(); w.git.resolveRef.mockClear();
    await expect(w.write({ files: [{ path: 'ui/package-lock.json', text: '{}' }] })).rejects.toMatchObject({ kind: 'git_path_refused' });
    await expect(w.write({ files: [{ path: 'ui/a.ts', text: 'new' }], deletes: ['ui/a.ts'] })).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(w.git.commit).not.toHaveBeenCalled();
  });
  it('should refuse partial commits, then commit exactly the full live delta', async () => {
    const w = liveWitness();
    await w.write({ files: [{ path: 'ui/a.ts', text: 'new' }], deletes: ['ui/b.ts'] });
    const input = { expectedHeadSha: 'a'.repeat(40), message: 'Update view', idempotencyKey: 'commit-1' };
    await expect(w.call('git_commit', { ...input, files: [{ path: 'ui/a.ts', text: 'new' }] }))
      .rejects.toMatchObject({ kind: 'git_live_snapshot_mismatch' });
    expect(w.git.commit).not.toHaveBeenCalled();
    await w.call('git_commit', { ...input, deletes: ['ui/b.ts'], files: [{ path: 'ui/a.ts', text: 'new' }] });
    expect(w.git.commit).toHaveBeenCalledTimes(1);
    expect((await w.status()).dirty).toBe(false);
  });
  it('should retain dirty source across external head movement and permit explicit reset', async () => {
    const w = liveWitness(); await w.write({ files: [{ path: 'ui/a.ts', text: 'retained' }] });
    w.setHead('f'.repeat(40));
    const state = await w.status();
    expect(state.baseHeadSha).toBe('a'.repeat(40));
    expect(state.currentHeadSha).toBe('f'.repeat(40));
    await expect(w.write({ files: [{ path: 'ui/a.ts', text: 'lost' }] })).rejects.toMatchObject({ kind: 'git_live_draft_conflict' });
    await w.call('live_reset', { expectedHeadSha: 'f'.repeat(40), expectedLiveRevision: state.liveRevision, idempotencyKey: 'reset' });
    expect((await w.status()).dirty).toBe(false);
  });
});
