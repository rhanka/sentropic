import { vi } from 'vitest';
import { createLiveService } from '../../src/server/live-service.js';
import { createMemoryLiveStore, type LiveStore } from '../../src/server/live-store.js';
import { gitBinding } from './git-binding-conformance.js';
import { liveTreeSha } from '../../src/server/live-tree.js';

export function liveWitness(options: { store?: LiveStore; now?: () => number; invited?: (actorId: string) => boolean } = {}) {
  let head = 'a'.repeat(40);
  let canReadCode = true;
  const binding = { ...gitBinding(), channel: 'personal' as const, executor: 'sandbox' as const, personalPrincipalId: 'alice', headCommitSha: head };
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
    commit: vi.fn(async input => {
      const treeSha = liveTreeSha(await git.snapshot(), input.files.map(f => ({ ...f, mode: '100644' })), input.target);
      for (const f of input.files) { if (f.text === null) baseFiles.delete(f.path); else baseFiles.set(f.path, f.text); }
      head = 'c'.repeat(40); return { commitSha: head, treeSha }; }),
    createBranch: vi.fn(async () => undefined),
  };
  const worker = { reconcile: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
  const store = options.store ?? createMemoryLiveStore();
  const service = createLiveService({ store, git, worker, ...(options.now ? { now: options.now } : {}),
    keys: { current: async () => ({ version: 'k1', key: Buffer.alloc(32, 3) }), resolve: async () => Buffer.alloc(32, 3) },
    authorize: async invocation => ({ binding, ownerId: 'alice', canReadCode, canWrite: true, humanLinked: true,
      invited: options.invited?.(invocation.actorId) ?? false,
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
  return { service, call, status, write, git, worker, binding, store, context, baseFiles, setHead: (sha: string) => { head = sha; },
    revoke: () => { canReadCode = false; } };
}
