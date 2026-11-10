import { describe, expect, it, vi } from 'vitest';
import { createGitHubForge } from '../src/adapters/github-forge.js';
import { createGitPort } from '../src/adapters/github-git-port.js';
import type { GitHubFetch } from '../src/adapters/github-http.js';
import type { GitPortRepository } from '../src/server/git-port.js';
import { createMemoryLiveStore, type LiveStore } from '../src/server/live-store.js';
import { liveWitness } from './fixtures/live-world.js';

const HEAD = '7c5052530'.padEnd(40, 'e'); const TREE = 'f'.repeat(40);
const API = 'https://api.github.com/repos/o/r';
const person = { name: 'Human', email: 'human@noreply.test' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const hex = (n: number) => n.toString(16).padStart(40, '0');

/** Store whose transactions expose whether the per-artifact lock is currently held. */
function lockProbe() {
  const inner = createMemoryLiveStore(); let depth = 0;
  const store: LiveStore = { ...inner, transaction: (identity, action) => inner.transaction(identity, async tx => {
    depth++;
    try { return await action(tx); } finally { depth--; }
  }) };
  return { store, locked: () => depth > 0 };
}

/** Fake GitHub REST with a large tree: a full walk would issue one /git/trees call per directory. */
function largeTreeGitHub(branch: string, locked: () => boolean) {
  const underLock: string[] = [];
  const fetcher = vi.fn(async (url: string) => {
    const path = url.slice(API.length);
    if (locked()) underLock.push(path);
    if (path === '') return json({ id: 123, full_name: 'o/r' });
    if (path === `/git/ref/heads/${branch}`) return json({ ref: `refs/heads/${branch}`, object: { sha: HEAD, type: 'commit' } });
    if (path === `/commits/${HEAD}`) return json({ sha: HEAD, parents: [], commit: { message: 'm', tree: { sha: TREE }, author: person, committer: person } });
    const tree = /^\/git\/trees\/([0-9a-f]{40})$/.exec(path);
    if (tree) return json({ sha: tree[1], truncated: false, tree: tree[1] === TREE
      ? Array.from({ length: 400 }, (_, i) => ({ path: `d${i}`, mode: '040000', type: 'tree', sha: hex(i + 1) }))
      : Array.from({ length: 50 }, (_, i) => ({ path: `f${i}.ts`, mode: '100644', type: 'blob', sha: hex(10_000 + i), size: 1 })) });
    return json({ message: 'Not Found' }, 404);
  });
  return { fetcher, underLock, urls: () => fetcher.mock.calls.map(([url]) => url) };
}

describe('live status and start without a tree walk under the lock', () => {
  it('should answer status and start from the head ref and commit only, with no forge call inside a transaction', async () => {
    const probe = lockProbe();
    const w = liveWitness({ store: probe.store }); w.setHead(HEAD);
    const gh = largeTreeGitHub(w.binding.branch, probe.locked);
    const repo: GitPortRepository = { storageScopeId: w.binding.storageScopeId, repoId: w.binding.repoId, locator: 'o/r',
      installationRef: 'i', branchPrefix: 'artifact/', allowedSubPaths: [''], canWrite: true, writablePaths: ['ui/**'], refusedWritePaths: [] };
    const port = createGitPort({ registry: { get: async () => repo }, forge: createGitHubForge(gh.fetcher as unknown as GitHubFetch),
      leases: { acquire: async () => ({ token: 'fake-only-lease', repositoryId: '123', expiresAt: '2099-01-01T00:00:00Z',
        permissions: { contents: 'write', metadata: 'read' }, credentialVersion: 'v1' }) },
      directory: { resolve: async () => person }, committer: person, authorize: async () => true, cursorKey: Buffer.alloc(32, 1) });
    w.git.resolveRef.mockImplementation((t, ref) => port.resolveRef(t, ref));
    w.git.inspectCommit.mockImplementation((t, sha) => port.inspectCommit(t, sha));
    w.git.snapshot.mockImplementation((t, sha) => port.snapshot!(t, sha));
    w.git.isAncestor.mockImplementation((t, a, b) => port.isAncestor(t, a, b));
    const state = await w.status();
    expect(state).toMatchObject({ currentHeadSha: HEAD, baseHeadSha: HEAD, liveTreeSha: TREE,
      bindingGeneration: w.binding.generation, liveRevision: expect.any(String), runtimeState: 'DORMANT' });
    const started = await w.call('live_control', { action: 'start', expectedHeadSha: state.currentHeadSha,
      expectedLiveRevision: state.liveRevision, idempotencyKey: 'start' });
    expect(started).toMatchObject({ liveSessionId: expect.any(String), liveRevision: state.liveRevision, replayed: false });
    expect(w.git.snapshot).not.toHaveBeenCalled();
    expect(gh.urls().filter(url => url.includes('/git/trees'))).toEqual([]);
    expect(gh.underLock).toEqual([]);
  });

  it('should check a moved head for fast-forward outside the transaction', async () => {
    const probe = lockProbe();
    const w = liveWitness({ store: probe.store });
    const locked: boolean[] = [];
    for (const name of ['resolveRef', 'inspectCommit', 'snapshot', 'isAncestor', 'read'] as const) {
      const original = w.git[name].getMockImplementation()!;
      (w.git[name] as any).mockImplementation(async (...args: any[]) => { locked.push(probe.locked()); return (original as any)(...args); });
    }
    const first = await w.status();
    w.setHead('c'.repeat(40));
    const moved = await w.status();
    expect(moved).toMatchObject({ currentHeadSha: 'c'.repeat(40), baseHeadSha: 'c'.repeat(40) });
    expect(moved.liveRevision).not.toBe(first.liveRevision);
    expect(w.git.isAncestor).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(40), 'c'.repeat(40));
    expect(w.git.snapshot).not.toHaveBeenCalled();
    expect(locked.length).toBeGreaterThan(0);
    expect(locked).not.toContain(true);
  });

  it('should not block status behind a concurrent slow forge call', async () => {
    const w = liveWitness();
    const original = w.git.snapshot.getMockImplementation()!;
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    w.git.snapshot.mockImplementationOnce(async (...args) => { await gate; return original(...args); });
    const reading = w.call('live_read');
    await vi.waitFor(() => expect(w.git.snapshot).toHaveBeenCalled());
    const blocked = Symbol('blocked');
    const status = await Promise.race([w.status(), new Promise(resolve => setTimeout(() => resolve(blocked), 1000))]);
    expect(status).not.toBe(blocked);
    expect(status).toMatchObject({ currentHeadSha: 'a'.repeat(40), liveRevision: expect.any(String) });
    release();
    expect(await reading).toMatchObject({ files: expect.any(Array) });
  });
});
