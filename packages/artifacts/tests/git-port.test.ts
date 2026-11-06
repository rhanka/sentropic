import { describe, expect, it, vi } from 'vitest';
import { createGitPort } from '../src/adapters/github-git-port.js';
import { GitForgeError } from '../src/server/git-port.js';
import { GitPortAdvanceUnknown } from '../src/server/git-port-session.js';
import { commitInput, fakeGit, target } from './fixtures/git-port-fake.js';

describe('enrolled GitPort', () => {
  it.each(['.env', 'ui/.env.local', '../ui/a.ts', 'ui/secret.pem', '.github/a'])('should refuse reads and writes before any forge call: %s', async path => {
    const f = fakeGit();
    await expect(f.port.read(target, { commitSha: f.initial, paths: [path] })).rejects.toMatchObject({ kind: 'git_path_refused' });
    await expect(f.port.commit({ ...commitInput(f.initial), files: [{ path, text: 'x' }] })).rejects.toMatchObject({ kind: 'git_path_refused' });
    expect(f.leases.acquire).not.toHaveBeenCalled(); expect(f.forge.repositoryId).not.toHaveBeenCalled();
  });
  it.each(['ui/package.json', 'packages/a/package-lock.json', 'api/a.ts', 'deploy/a', '.track/a'])('should refuse A1 writes before leasing: %s', async path => {
    const f = fakeGit();
    await expect(f.port.commit({ ...commitInput(f.initial), files: [{ path, text: null }] })).rejects.toThrow('git_path_refused');
    expect(f.leases.acquire).not.toHaveBeenCalled();
  });
  it('should create one multi-file commit with a mapped human and App committer', async () => {
    const f = fakeGit(); const result = await f.port.commit(commitInput(f.initial));
    expect(f.refs.get(target.branch)).toBe(result.commitSha);
    expect(f.forge.createCommit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.forge.createCommit).mock.calls[0][1]).toMatchObject({
      parentSha: f.initial, author: { name: 'Human' }, committer: f.options.committer,
      message: expect.stringContaining(`Artifacts-Invocation: invocation-1\nArtifacts-Base: ${f.initial}`),
    });
    const page = await createGitPort({ ...f.options, pageSize: 100 }).read(target, { commitSha: result.commitSha });
    expect(page.files).toEqual([{ path: 'ui/a.ts', text: 'updated', encoding: 'utf-8' }, { path: 'ui/c.ts', text: 'created', encoding: 'utf-8' }]);
    expect(await f.port.isAncestor(target, f.initial, result.commitSha)).toBe(true);
  });
  it('should keep every page at the resolved SHA after the branch moves', async () => {
    const f = fakeGit(); const pinned = await f.port.resolveRef(target, target.branch);
    const first = await f.port.read(target, { commitSha: pinned });
    await f.port.commit(commitInput(f.initial));
    const second = await f.port.read(target, { commitSha: pinned, cursor: first.nextCursor! });
    expect([...first.files, ...second.files].map(file => file.path)).toEqual(['ui/a.ts', 'ui/b.ts']);
    expect(second.files[0]).toMatchObject({ text: 'second' }); expect(second.nextCursor).toBeNull();
    const calls = f.leases.acquire.mock.calls.length;
    await expect(f.port.read({ ...target, principalId: 'another' }, { commitSha: pinned, cursor: first.nextCursor! })).rejects.toThrow('invalid_request');
    expect(f.leases.acquire).toHaveBeenCalledTimes(calls);
  });
  it('should admit exactly one concurrent commit from the same expected head', async () => {
    const f = fakeGit();
    const outcomes = await Promise.allSettled([f.port.commit(commitInput(f.initial)),
      f.port.commit({ ...commitInput(f.initial), invocationId: 'invocation-2', files: [{ path: 'ui/a.ts', text: 'other' }] })]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    const loser = outcomes.find(o => o.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ kind: 'git_head_moved', details: { publicDetails: { expectedHeadSha: f.initial, actualHeadSha: f.refs.get(target.branch) } } });
  });
  it('should refuse missing human linkage and denied rights without leasing', async () => {
    const f = fakeGit(); f.options.directory.resolve.mockResolvedValue(null!);
    await expect(f.port.commit(commitInput(f.initial))).rejects.toThrow('access_denied');
    f.options.authorize.mockResolvedValue(false);
    await expect(f.port.read(target, { commitSha: f.initial })).rejects.toThrow('access_denied');
    expect(f.leases.acquire).not.toHaveBeenCalled();
  });
  it.each(['expired', 'repository', 'permissions', 'missing-broker'])('should fail closed on invalid enrollment: %s', async scenario => {
    const f = fakeGit();
    if (scenario === 'expired') f.lease.expiresAt = '2000-01-01T00:00:00Z';
    if (scenario === 'repository') f.lease.repositoryId = 'foreign';
    if (scenario === 'permissions') Object.assign(f.lease.permissions, { workflows: 'write' });
    const port = createGitPort({ ...f.options, ...(scenario === 'missing-broker' ? { leases: undefined } : {}) });
    await expect(port.commit(commitInput(f.initial))).rejects.toMatchObject({ kind: scenario === 'repository' ? 'access_denied' : 'provider_unavailable' });
    expect(f.forge.createTree).not.toHaveBeenCalled();
  });
  it('should fence a revoked lease between object creation and commit creation', async () => {
    const f = fakeGit(); const create = f.forge.createTree;
    f.forge.createTree = async (...args) => {
      const tree = await create(...args);
      f.port.invalidate({ ...target, installationRef: 'enrolled', credentialVersion: 'v1' }); return tree;
    };
    await expect(f.port.commit(commitInput(f.initial))).rejects.toThrow('provider_unavailable');
    expect(f.forge.createCommit).not.toHaveBeenCalled(); expect(f.refs.get(target.branch)).toBe(f.initial);
  });
  it('should expose an indeterminate ref result after a lost acknowledgement', async () => {
    const f = fakeGit(); const advance = f.forge.advance;
    f.forge.advance = async (...args) => { await advance(...args); throw new GitForgeError('unknown'); };
    await expect(f.port.commit(commitInput(f.initial))).rejects.toBeInstanceOf(GitPortAdvanceUnknown);
    expect(f.refs.get(target.branch)).not.toBe(f.initial); expect(f.forge.createCommit).toHaveBeenCalledTimes(1);
  });
});
