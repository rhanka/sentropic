import { describe, expect, it } from 'vitest';
import { ARTIFACT, SHA_A, SHA_B, gitToolsWorld } from './fixtures/git-tools-world.js';

const attach = { artifactId: ARTIFACT, repoId: 'repo-a', baseRef: 'main', idempotencyKey: 'k-attach' };
const refused = (status: number, publicCode: string) => ({ ok: false, failure: { httpStatus: status, publicCode } });

describe('git tool routing (G0 v3 §1.3)', () => {
  it('should refuse each tool with capability_unavailable when no host port is injected', async () => {
    const w = gitToolsWorld({ withService: false });
    expect(await w.call('fetch_app_source', { repoId: 'repo-a', ref: 'main' })).toMatchObject(refused(503, 'capability_unavailable'));
    expect(await w.call('git_attach', attach)).toMatchObject(refused(503, 'capability_unavailable'));
    expect(await w.call('git_publish', { artifactId: ARTIFACT, commitSha: SHA_A, expectedCurrentReleaseId: null, idempotencyKey: 'k' }))
      .toMatchObject(refused(503, 'capability_unavailable'));
  });
  it('should not route a tool the profile did not select', async () => {
    const w = gitToolsWorld({ tools: ['git_attach'] });
    expect(await w.call('fetch_app_source', { repoId: 'repo-a', ref: 'main' })).toMatchObject({ ok: false });
    expect(await w.call('git_attach', attach)).toMatchObject({ ok: true });
  });
  it('should serve the same attach through MCP and HTTP', async () => {
    const w = gitToolsWorld();
    const mcp = await w.world.mcp.execute({ tool: 'artifacts_git_attach', args: attach, invocation: w.world.invocation() });
    expect(mcp).toMatchObject({ ok: true, result: { body: { git: { repoId: 'repo-a', state: 'attached' } } } });
  });
});
describe('artifacts_fetch_app_source', () => {
  it('should read a repo ref, parse the descriptor and journal repoId + SHA', async () => {
    const w = gitToolsWorld();
    const out = await w.call('fetch_app_source', { repoId: 'repo-a', ref: 'main' });
    expect(out).toMatchObject({ ok: true, result: { body: { repoId: 'repo-a', commitSha: SHA_A, treeSha: 'c'.repeat(40),
      descriptor: { buildScript: 'build:artifact' }, files: [{ path: 'ui/a.ts', text: 'alpha' }] } } });
    expect(w.journal).toHaveBeenCalledWith(expect.objectContaining({ repoId: 'repo-a', commitSha: SHA_A }));
  });
  it('should pin the resolved commit in the cursor across pages', async () => {
    const w = gitToolsWorld();
    const first: any = await w.call('fetch_app_source', { repoId: 'repo-a', ref: 'main' });
    w.heads.set('main', SHA_B);
    const second: any = await w.call('fetch_app_source', { repoId: 'repo-a', ref: 'main', cursor: first.result.body.nextCursor });
    expect(second.result.body.commitSha).toBe(SHA_A);
    expect(await w.call('fetch_app_source', { repoId: 'repo-a', ref: 'main', cursor: 'garbage' })).toMatchObject(refused(400, 'invalid_request'));
  });
  it('should resolve the bound branch from artifactId and refuse without a binding', async () => {
    const w = gitToolsWorld();
    expect(await w.call('fetch_app_source', { artifactId: ARTIFACT })).toMatchObject(refused(422, 'git_not_attached'));
    await w.call('git_attach', attach);
    const out: any = await w.call('fetch_app_source', { artifactId: ARTIFACT, paths: ['ui/a.ts'] });
    expect(out.ok).toBe(true);
    expect(w.git.read.mock.calls.at(-1)![0]).toMatchObject({ branch: expect.stringMatching(/^artifact\/p\//) });
  });
  it('should refuse without the code right and without a ref, revealing nothing', async () => {
    const denied = gitToolsWorld({ rights: false });
    expect(await denied.call('fetch_app_source', { repoId: 'repo-a', ref: 'main' })).toMatchObject(refused(403, 'access_denied'));
    expect(denied.git.read).not.toHaveBeenCalled();
    const w = gitToolsWorld();
    expect(await w.call('fetch_app_source', { repoId: 'repo-a' })).toMatchObject(refused(400, 'invalid_request'));
    expect(await w.call('fetch_app_source', { repoId: 'repo-x', ref: 'main' })).toMatchObject(refused(422, 'git_repo_not_registered'));
  });
});
describe('artifacts_git_attach', () => {
  it('should create a personal branch from baseRef with the personal-only default and replay by key', async () => {
    const w = gitToolsWorld();
    const out: any = await w.call('git_attach', attach);
    expect(out.result.body.git).toMatchObject({ channel: 'personal', autoPublish: true, executor: 'caller', headCommitSha: SHA_A, generation: 1 });
    expect(out.result.body.git.branch).toMatch(/^artifact\/p\/[0-9a-f]{8}\/app-[0-9a-f]{8}$/);
    expect(w.git.createBranch).toHaveBeenCalledTimes(1);
    expect(await w.call('git_attach', attach)).toMatchObject({ ok: true, replayed: true });
  });
  it('should keep autoPublish false under the generic none policy and refuse an explicit enablement', async () => {
    const w = gitToolsWorld({ delegated: 'none' });
    const out: any = await w.call('git_attach', attach);
    expect(out.result.body.git.autoPublish).toBe(false);
    const refusedAuto = gitToolsWorld({ delegated: 'none' });
    expect(await refusedAuto.call('git_attach', { ...attach, autoPublish: true })).toMatchObject(refused(422, 'git_auto_publish_refused'));
  });
  it('should attach a pre-existing branch with autoPublish false and refuse enabling it in that first attach', async () => {
    const w = gitToolsWorld();
    const args = { artifactId: ARTIFACT, repoId: 'repo-a', branch: 'artifact/shared/demo', idempotencyKey: 'k1' };
    expect(await w.call('git_attach', { ...args, autoPublish: true })).toMatchObject(refused(422, 'git_auto_publish_refused'));
    const out: any = await w.call('git_attach', args);
    expect(out.result.body.git).toMatchObject({ channel: 'shared', autoPublish: false, personalPrincipalId: null });
    expect(w.git.createBranch).not.toHaveBeenCalled();
  });
  it('should refuse ci, an unqualified sandbox, foreign branches and unregistered repos before any forge call', async () => {
    const w = gitToolsWorld();
    expect(await w.call('git_attach', { ...attach, executor: 'ci' })).toMatchObject(refused(503, 'builder_unavailable'));
    expect(await w.call('git_attach', { ...attach, executor: 'sandbox' })).toMatchObject(refused(503, 'builder_unavailable'));
    expect(await w.call('git_attach', { ...attach, branch: 'artifact/p/ffffffff/x' })).toMatchObject(refused(422, 'git_ref_not_allowed'));
    expect(await w.call('git_attach', { ...attach, branch: 'main' })).toMatchObject(refused(422, 'git_ref_not_allowed'));
    expect(await w.call('git_attach', { ...attach, repoId: 'repo-x' })).toMatchObject(refused(422, 'git_repo_not_registered'));
    expect(w.git.createBranch).not.toHaveBeenCalled();
    expect((await w.bindings.get('scope-a', ARTIFACT))).toBeUndefined();
  });
  it('should admit sandbox only when the build port opens it', async () => {
    const w = gitToolsWorld({ build: { admits: async () => true, request: async () => ({ jobId: 'j', state: 'build_pending' }) } });
    const out: any = await w.call('git_attach', { ...attach, executor: 'sandbox' });
    expect(out.result.body.git.executor).toBe('sandbox');
  });
  it('should require owner, host write scope, repoId and the code right', async () => {
    expect(await gitToolsWorld().call('git_attach', attach, 'bob')).toMatchObject(refused(403, 'access_denied'));
    expect(await gitToolsWorld({ canWrite: false }).call('git_attach', attach)).toMatchObject(refused(403, 'access_denied'));
    expect(await gitToolsWorld().call('git_attach', { artifactId: ARTIFACT, idempotencyKey: 'k' })).toMatchObject(refused(400, 'invalid_request'));
  });
  it('should pause, resume and detach, and refuse mixed detach arguments', async () => {
    const w = gitToolsWorld();
    await w.call('git_attach', attach);
    const control = (extra: Record<string, unknown>, key: string) => w.call('git_attach', { artifactId: ARTIFACT, idempotencyKey: key, ...extra });
    expect((await control({ pause: true }, 'p') as any).result.body.git).toMatchObject({ state: 'paused', generation: 2 });
    expect((await control({ pause: false }, 'r') as any).result.body.git.state).toBe('attached');
    expect(await control({ detach: true, branch: 'artifact/x' }, 'd0')).toMatchObject(refused(400, 'invalid_request'));
    expect((await control({ detach: true }, 'd') as any).result.body.git.state).toBe('detached');
    expect(await control({ pause: true }, 'p2')).toMatchObject(refused(422, 'git_not_attached'));
  });
  it('should refuse switching target on an active binding and re-attach with a new generation', async () => {
    const w = gitToolsWorld();
    await w.call('git_attach', attach);
    expect(await w.call('git_attach', { ...attach, idempotencyKey: 'k2', branch: 'artifact/shared/demo' }))
      .toMatchObject(refused(409, 'git_binding_conflict'));
    await w.call('git_attach', { artifactId: ARTIFACT, detach: true, idempotencyKey: 'd' });
    const again: any = await w.call('git_attach', { ...attach, idempotencyKey: 'k3' });
    expect(again.result.body.git.generation).toBe(3);
  });
});
describe('artifacts_git_publish', () => {
  const publish = (sha = SHA_A, key = 'pub-1') => ({ artifactId: ARTIFACT, commitSha: sha, expectedCurrentReleaseId: null, idempotencyKey: key });
  it('should persist the job, move the binding to build_pending and replay by key', async () => {
    const w = gitToolsWorld();
    await w.call('git_attach', attach);
    const out: any = await w.call('git_publish', publish());
    expect(out.result.body).toMatchObject({ jobId: 'job-pub-1', state: 'build_pending', commitSha: SHA_A });
    expect(w.build).toHaveBeenCalledWith(expect.objectContaining({ commitSha: SHA_A, bindingGeneration: 1, expectedCurrentReleaseId: null, executor: 'caller' }));
    expect(await w.bindings.get('scope-a', ARTIFACT)).toMatchObject({ state: 'build_pending', pendingJobId: 'job-pub-1', pendingCommitSha: SHA_A });
    expect(await w.call('git_publish', publish(SHA_A, 'pub-2'))).toMatchObject({ ok: true, replayed: true, result: { body: { jobId: 'job-pub-1' } } });
  });
  it('should refuse a SHA outside the branch before any build', async () => {
    const w = gitToolsWorld();
    await w.call('git_attach', attach);
    expect(await w.call('git_publish', publish(SHA_B))).toMatchObject(refused(422, 'git_sha_not_on_branch'));
    expect(await w.call('git_publish', publish('abc'))).toMatchObject(refused(400, 'invalid_request'));
    expect(w.build).not.toHaveBeenCalled();
  });
  it('should fail closed without a build port or when the executor gate is closed', async () => {
    const none = gitToolsWorld({ build: false });
    await none.call('git_attach', attach);
    expect(await none.call('git_publish', publish())).toMatchObject(refused(503, 'capability_unavailable'));
    let open = true;
    const closed = gitToolsWorld({ build: { admits: async () => open, request: async () => ({ jobId: 'j', state: 'build_pending' }) } });
    await closed.call('git_attach', attach);
    open = false;
    expect(await closed.call('git_publish', publish())).toMatchObject(refused(503, 'builder_unavailable'));
  });
  it('should refuse unattached, paused and non-owner publishers', async () => {
    const w = gitToolsWorld();
    expect(await w.call('git_publish', publish())).toMatchObject(refused(422, 'git_not_attached'));
    await w.call('git_attach', attach);
    expect(await w.call('git_publish', publish(), 'bob')).toMatchObject(refused(403, 'access_denied'));
    await w.call('git_attach', { artifactId: ARTIFACT, pause: true, idempotencyKey: 'p' });
    expect(await w.call('git_publish', publish())).toMatchObject(refused(409, 'git_binding_paused'));
    expect(w.build).not.toHaveBeenCalled();
  });
});
