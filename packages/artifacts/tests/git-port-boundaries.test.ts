import { describe, expect, it, vi } from 'vitest';
import { createGitPort } from '../src/adapters/github-git-port.js';
import { classifyArtifactFailure } from '../src/server/failures.js';
import { createEnrolledWitnessGitPort } from './fixtures/git-port-witness.js';
import { commitInput, fakeGit, target } from './fixtures/git-port-fake.js';

describe('GitPort source and policy boundaries', () => {
  it('should read registered source refs outside the writable artifact namespace', async () => {
    const f = fakeGit(); f.refs.set('main', f.initial);
    expect(await f.port.resolveRef({ ...target, branch: 'main' }, 'main')).toBe(f.initial);
    await expect(f.port.commit({ ...commitInput(f.initial), target: { ...target, branch: 'main' } })).rejects.toThrow('git_ref_not_allowed');
  });
  it('should preserve UTF-8 BOMs and refuse private-key bytes hidden under a source filename', async () => {
    const f = fakeGit({ 'ui/bom': '\ufeffsource', 'ui/hidden': '-----BEGIN PRIVATE KEY-----' });
    expect((await f.port.read(target, { commitSha: f.initial, paths: ['ui/bom'] })).files[0]).toMatchObject({ text: '\ufeffsource' });
    await expect(f.port.read(target, { commitSha: f.initial, paths: ['ui/hidden'] })).rejects.toThrow('git_path_refused');
  });
  it('should reject an ancestor rewind between object creation and ref advance', async () => {
    const f = fakeGit(); const prior = await f.port.commit(commitInput(f.initial));
    const create = f.forge.createTree;
    f.forge.createTree = async (...args) => { const tree = await create(...args); f.refs.set(target.branch, f.initial); return tree; };
    await expect(f.port.commit({ ...commitInput(prior.commitSha), files: [{ path: 'ui/a.ts', text: 'next' }] })).rejects.toMatchObject({
      kind: 'git_head_moved', details: { publicDetails: { expectedHeadSha: prior.commitSha, actualHeadSha: f.initial } },
    });
    expect(f.refs.get(target.branch)).toBe(f.initial);
  });
  it('should expose parent, join trailers and attribution for crash reconciliation', async () => {
    const f = fakeGit(); const written = await f.port.commit(commitInput(f.initial));
    expect(await f.port.inspectCommit(target, written.commitSha)).toMatchObject({ parents: [f.initial],
      author: { name: 'Human' }, committer: f.options.committer, message: expect.stringContaining('Artifacts-Invocation: invocation-1') });
  });
  it('should omit over-budget entries and keep binary source byte-exact', async () => {
    const f = fakeGit({ 'ui/a': '1234', 'ui/b': '12345', 'ui/c': '6789', 'ui/d': '\0binary' });
    const port = createGitPort({ ...f.options, pageSize: 100, maxFileBytes: 4, maxTotalBytes: 6 });
    const page = await port.read(target, { commitSha: f.initial });
    expect(page.files).toEqual([{ path: 'ui/a', text: '1234', encoding: 'utf-8' },
      { path: 'ui/b', omitted: 'too_large' }, { path: 'ui/c', omitted: 'over_total_budget' }, { path: 'ui/d', omitted: 'too_large' }]);
    expect(f.forge.blob).toHaveBeenCalledTimes(1);
    const binary = await f.port.read(target, { commitSha: f.initial, paths: ['ui/d'] });
    expect(binary.files).toEqual([{ path: 'ui/d', encoding: 'base64', base64: Buffer.from('\0binary').toString('base64') }]);
  });
  it('should exclude secret subtrees without reading their blobs', async () => {
    const f = fakeGit({ '.env': 'fake-secret', 'ui/.env.local': 'fake-secret', 'ui/id_rsa': 'fake-key', 'ui/a': 'source', 'package.json': '{}' });
    const page = await createGitPort({ ...f.options, pageSize: 100 }).read(target, { commitSha: f.initial });
    expect(page.files.map(file => file.path)).toEqual(['package.json', 'ui/a']);
    expect(f.forge.blob).toHaveBeenCalledTimes(2);
  });
  it('should reject a symlink ancestor before reading or writing any blob', async () => {
    const f = fakeGit(); const root = f.commits.get(f.initial)!.treeSha;
    const ui = f.trees.get(root)!.find(entry => entry.path === 'ui')!;
    ui.mode = '120000'; ui.type = 'blob';
    await expect(f.port.read(target, { commitSha: f.initial, paths: ['ui/a.ts'] })).rejects.toThrow('git_path_refused');
    await expect(f.port.commit(commitInput(f.initial))).rejects.toThrow('git_path_refused');
    expect(f.forge.blob).not.toHaveBeenCalled(); expect(f.forge.createTree).not.toHaveBeenCalled();
  });
  it('should refuse stale heads before constructing any objects', async () => {
    const f = fakeGit(); f.refs.set(target.branch, 'f'.repeat(40));
    f.commits.set('f'.repeat(40), { ...f.commits.get(f.initial)!, sha: 'f'.repeat(40) });
    await expect(f.port.commit(commitInput(f.initial))).rejects.toThrow('git_head_moved');
    expect(f.forge.createTree).not.toHaveBeenCalled();
  });
  it('should recheck total byte budgets across page boundaries', async () => {
    const f = fakeGit({ 'ui/a': '1234', 'ui/b': '5678' });
    const port = createGitPort({ ...f.options, maxTotalBytes: 6 });
    const first = await port.read(target, { commitSha: f.initial });
    const second = await port.read(target, { commitSha: f.initial, cursor: first.nextCursor! });
    expect(second.files).toEqual([{ path: 'ui/b', omitted: 'over_total_budget' }]);
  });
  it('should reject quota-sized writes, forged join trailers and embedded private keys before leasing', async () => {
    const f = fakeGit(); const input = commitInput(f.initial);
    await expect(createGitPort({ ...f.options, maxFileBytes: 2 }).commit(input)).rejects.toThrow('limit_exceeded');
    await expect(f.port.commit({ ...input, message: 'Update\nArtifacts-Invocation: forged' })).rejects.toThrow('invalid_request');
    await expect(f.port.commit({ ...input, files: [{ path: 'ui/key.txt', text: '-----BEGIN PRIVATE KEY-----' }] })).rejects.toThrow('git_path_refused');
    expect(f.leases.acquire).not.toHaveBeenCalled();
  });
  it('should project stable typed error status and details', async () => {
    const f = fakeGit();
    const error = await f.port.read(target, { commitSha: f.initial, paths: ['.env'] }).catch(e => e);
    const failure = classifyArtifactFailure(error, { operation: 'git_read', invocationId: 'test', phase: 'admit', commitState: 'not_committed' });
    expect(failure).toMatchObject({ httpStatus: 422, publicCode: 'git_path_refused', details: { path: '.env', reason: 'reserved' } });
  });
  it('should keep the real witness adapter off without an enrolled host', () => {
    const network = vi.spyOn(globalThis, 'fetch');
    expect(createEnrolledWitnessGitPort()).toBeUndefined();
    const f = fakeGit();
    expect(createEnrolledWitnessGitPort({ enrollment: { ready: false, receiptRef: '', ...target, installationRef: 'enrolled' }, host: f.options })).toBeUndefined();
    expect(network).not.toHaveBeenCalled(); expect(f.leases.acquire).not.toHaveBeenCalled(); network.mockRestore();
  });
});
