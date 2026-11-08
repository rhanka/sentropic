import { describe, expect, it, vi } from 'vitest';
import { createGitHubForge } from '../src/adapters/github-forge.js';
import { createGitPort } from '../src/adapters/github-git-port.js';
import type { GitHubFetch } from '../src/adapters/github-http.js';
import type { GitPortRepository } from '../src/server/git-port.js';
import { gitToolsWorld } from './fixtures/git-tools-world.js';
import { liveWitness } from './fixtures/live-world.js';

const HEAD = '7c5052530'.padEnd(40, 'e'); const MAIN = 'd'.repeat(40); const TREE = 'f'.repeat(40);
const SLASH_BRANCH = 'artifact/p/bbfae795/app-705aef0a';
const API = 'https://api.github.com/repos/o/r';
const person = { name: 'Human', email: 'human@noreply.test' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Fake GitHub REST: exact git/ref lookups, 422 « No commit found » for unknown commits, ref creation. */
function fakeGitHub(heads: Record<string, string>) {
  const refs = new Map(Object.entries(heads));
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.slice(API.length);
    if (path === '') return json({ id: 123, full_name: 'o/r' });
    const ref = /^\/git\/ref\/heads\/(.+)$/.exec(path);
    if (ref) {
      if (ref[1].includes('%2F')) return json({ message: 'Not Found' }, 404);
      const branch = ref[1].split('/').map(decodeURIComponent).join('/');
      const head = refs.get(branch);
      return head ? json({ ref: `refs/heads/${branch}`, object: { sha: head, type: 'commit' } }) : json({ message: 'Not Found' }, 404);
    }
    const commit = /^\/commits\/(.+)$/.exec(path);
    if (commit) {
      if (![...refs.values()].includes(commit[1])) return json({ message: `No commit found for SHA: ${commit[1]}` }, 422);
      return json({ sha: commit[1], parents: [], commit: { message: 'm', tree: { sha: TREE }, author: person, committer: person } });
    }
    if (path === '/git/refs' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); const branch = body.ref.slice('refs/heads/'.length);
      if (refs.has(branch)) return json({ message: 'Reference already exists' }, 422);
      refs.set(branch, body.sha); return json({ ref: body.ref, object: { sha: body.sha } }, 201);
    }
    return json({ message: 'Not Found' }, 404);
  });
  return { refs, fetcher, urls: () => fetcher.mock.calls.map(([url]) => url) };
}
function githubPort(gh: ReturnType<typeof fakeGitHub>, storageScopeId: string) {
  const repo: GitPortRepository = { storageScopeId, repoId: 'repo-a', locator: 'o/r', installationRef: 'i', branchPrefix: 'artifact/',
    allowedSubPaths: [''], canWrite: true, writablePaths: ['ui/**'], refusedWritePaths: [] };
  return createGitPort({ registry: { get: async () => repo }, forge: createGitHubForge(gh.fetcher as unknown as GitHubFetch),
    leases: { acquire: async () => ({ token: 'fake-only-lease', repositoryId: '123', expiresAt: '2099-01-01T00:00:00Z',
      permissions: { contents: 'write', metadata: 'read' }, credentialVersion: 'v1' }) },
    directory: { resolve: async () => person }, committer: person, authorize: async () => true, cursorKey: Buffer.alloc(32, 1) });
}
const context = { locator: 'o/r', token: 'fake-only-lease' };
const target = (branch: string) => ({ storageScopeId: 'scope-a', repoId: 'repo-a', branch, subPath: '', principalId: 'alice', outputDir: 'dist' });

describe('GitHub branch resolution (fake HTTP only)', () => {
  it('should resolve a slash branch through git/ref with per-segment encoding to the full commit SHA', async () => {
    const gh = fakeGitHub({ [SLASH_BRANCH]: HEAD });
    expect(await createGitHubForge(gh.fetcher as unknown as GitHubFetch).resolve(context, SLASH_BRANCH)).toMatchObject({ sha: HEAD, treeSha: TREE });
    expect(gh.urls()).toEqual([`${API}/git/ref/heads/${SLASH_BRANCH}`, `${API}/commits/${HEAD}`]);
    expect(await githubPort(gh, 'scope-a').resolveRef(target(SLASH_BRANCH), SLASH_BRANCH)).toBe(HEAD);
  });
  it.each([404, 422])('should report an absent branch as missing when git/ref answers %i', async status => {
    const forge = createGitHubForge(vi.fn(async () => json({ message: 'No commit found' }, status)) as unknown as GitHubFetch);
    await expect(forge.resolve(context, SLASH_BRANCH)).rejects.toMatchObject({ code: 'missing' });
  });
  it('should map a 422 on /commits to missing instead of git_ref_not_allowed', async () => {
    const port = githubPort(fakeGitHub({ main: MAIN }), 'scope-a');
    await expect(port.inspectCommit(target(SLASH_BRANCH), 'a'.repeat(40))).rejects.toMatchObject({ kind: 'not_found' });
    await expect(port.resolveRef(target(SLASH_BRANCH), SLASH_BRANCH)).rejects.toMatchObject({ kind: 'git_branch_missing' });
  });
  it('should create a new personal branch from baseRef through the GitHub port', async () => {
    const gh = fakeGitHub({ main: MAIN }); const w = gitToolsWorld(); const port = githubPort(gh, 'scope-a');
    Object.assign(w.git, { resolveRef: port.resolveRef, createBranch: port.createBranch });
    const out: any = await w.call('git_attach', { artifactId: '11111111-1111-4111-8111-111111111111', repoId: 'repo-a',
      baseRef: 'main', idempotencyKey: 'k-attach' });
    expect(out).toMatchObject({ ok: true, result: { body: { git: { state: 'attached', headCommitSha: MAIN } } } });
    expect(gh.refs.get(out.result.body.git.branch)).toBe(MAIN);
  });
  it('should start a live session on a resolved slash-branch head', async () => {
    const w = liveWitness(); const gh = fakeGitHub({ [w.binding.branch]: HEAD }); w.setHead(HEAD);
    const port = githubPort(gh, w.binding.storageScopeId);
    w.git.resolveRef.mockImplementation((t, ref) => port.resolveRef(t, ref));
    w.worker.reconcile.mockImplementation(async identity => {
      const record = await w.store.transaction(identity, async tx => tx.record!);
      return { liveSessionId: record.runtime!.liveSessionId, leaseEpoch: record.runtime!.leaseEpoch,
        routeEpoch: record.runtime!.routeEpoch, revision: record.revision, ready: true };
    });
    const state = await w.status();
    expect(state.currentHeadSha).toBe(HEAD);
    expect(await w.call('live_control', { action: 'start', expectedHeadSha: HEAD, expectedLiveRevision: state.liveRevision,
      idempotencyKey: 'start' })).toMatchObject({ liveSessionId: expect.any(String) });
    expect(gh.urls()).toContain(`${API}/git/ref/heads/${w.binding.branch}`);
  });
});
