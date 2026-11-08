import { describe, expect, it, vi } from 'vitest';
import { key } from './fixture';
import { fences, file, grant, HEAD, reconcile, session, setup, stop, TREE } from './host-live-harness';

describe('host live API (remote host D0)', () => {
  it('refuses a host bound to no scope on every route before reading the body', async () => {
    const s = setup();
    for (const path of ['reconcile', 'stop', 'grant', 'draft/page', 'draft/seal']) {
      const response = await s.call(path, 'x'.repeat(4 * 1024 * 1024), 'nobody');
      expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'host_not_bound' });
    }
    expect(await s.f.state()).toBeUndefined();
  });
  it('reconciles the pushed draft to LIVE and ACKs the package fences of the body', async () => {
    const s = setup(); await s.stage('r1');
    const response = await s.call('reconcile', reconcile());
    expect(await response.json()).toEqual({ ...fences, revision: 'r1', ready: true });
    expect((await s.f.state())?.runtime).toMatchObject({ phase: 'LIVE', ownerId: 'owner', appliedRevision: 'r1' });
  });
  it('answers ready=false with the current revision while the applied revision differs', async () => {
    const s = setup(50); await s.stage('r1'); await s.call('reconcile', reconcile());
    vi.mocked(s.f.ports.worker.live).mockImplementationOnce(() => new Promise(() => {}));
    await s.stage('r2');
    expect(await (await s.call('reconcile', reconcile())).json()).toEqual({ ...fences, revision: 'r2', ready: false });
    expect((await s.f.state())?.runtime).toMatchObject({ sourceRevision: 'r2', appliedRevision: null });
  });
  it('refuses a reconcile older than the recorded package fences', async () => {
    const s = setup(); await s.stage('r1'); await s.call('reconcile', reconcile());
    for (const over of [{ leaseEpoch: 6 }, { routeEpoch: 8 }, { liveSessionId: 'other-session' }, { ownerId: 'bob' }]) {
      const response = await s.call('reconcile', reconcile(over));
      expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'git_live_conflict', reason: 'stale_session' });
    }
  });
  it('grants the binding owner a read route only while LIVE', async () => {
    const s = setup(); await s.stage('r1');
    expect(await (await s.call('grant', grant({ principalId: 'owner' }))).json()).toEqual({ error: 'git_live_conflict', reason: 'stale_session' });
    await s.call('reconcile', reconcile());
    const ok = await s.call('grant', grant({ principalId: 'owner' }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).grant).toMatchObject({ ...key, role: 'binding_owner', principalId: 'owner', sourceRevision: 'r1' });
    expect((await s.call('stop', stop())).status).toBe(204);
    const dormant = await s.call('grant', grant({ principalId: 'owner' }));
    expect(dormant.status).toBe(409); expect(await dormant.json()).toEqual({ error: 'git_live_conflict', reason: 'invalid_phase' });
  });
  it('refuses a stop with a stale lease epoch and keeps the session LIVE', async () => {
    const s = setup(); await s.stage('r1'); await s.call('reconcile', reconcile());
    for (const over of [{ leaseEpoch: 6 }, { liveSessionId: 'other-session' }, { bindingGeneration: 2 }]) {
      const response = await s.call('stop', stop(over));
      expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'git_live_conflict', reason: 'stale_session' });
    }
    expect((await s.f.state())?.runtime.phase).toBe('LIVE');
    expect((await s.call('stop', stop())).status).toBe(204); expect((await s.f.state())?.runtime.phase).toBe('DORMANT');
  });
  it('lets a host of another storage scope see nothing of the binding', async () => {
    const s = setup(); await s.stage('r1'); await s.call('reconcile', reconcile());
    expect(await (await s.call('grant', grant({ principalId: 'owner' }), 'other')).json()).toMatchObject({ reason: 'stale_session' });
    expect(await (await s.call('stop', stop(), 'other')).json()).toMatchObject({ reason: 'stale_session' });
    expect(await (await s.call('reconcile', reconcile(), 'other')).json()).toMatchObject({ reason: 'draft_not_staged' });
    await s.stage('evil', 'other');
    expect((await s.drafts.drafts.current(key, 1)).revision).toBe('r1');
    expect((await s.f.state())?.runtime).toMatchObject({ phase: 'LIVE', appliedRevision: 'r1' });
    expect(await s.f.state({ storageScopeId: 'scope-b', artifactId: key.artifactId })).toBeUndefined();
  });
  it('accepts only closed, bounded bodies', async () => {
    const s = setup();
    const page = (over: Record<string, unknown>) => ({ artifactId: key.artifactId, bindingGeneration: 1, revision: 'r1', page: 0,
      files: [file('a.txt', 'a')], ...over });
    const invalid: Array<[string, unknown]> = [
      ['reconcile', reconcile({ storageScopeId: 'scope-b' })], ['reconcile', { ...reconcile(), ownerId: undefined }],
      ['reconcile', reconcile({ leaseEpoch: -1 })], ['reconcile', reconcile({ artifactId: '../x' })], ['reconcile', 'not json'],
      ['reconcile', { ...reconcile(), invitation: undefined }], ['reconcile', reconcile({ invitation: { epoch: 1 } })],
      ['reconcile', reconcile({ invitation: { epoch: 1, expiresAt: '9000' } })], ['reconcile', reconcile({ invitation: session(-1) })],
      ['reconcile', reconcile({ invitation: { ...session(1), id: 'i' } })],
      ['grant', { ...grant({ principalId: 'owner' }), invitation: undefined, invitationEpoch: 1 }],
      ['grant', grant({ principalId: 'owner' }, null)], ['grant', grant({ principalId: 'owner' }, { epoch: 1.5, expiresAt: null })],
      ['stop', stop({ routeEpoch: 9 })], ['grant', { ...grant({ principalId: 'owner' }), access: 'write' }],
      ['grant', grant({ principalId: 'owner', role: 'binding_owner' })],
      ['grant', grant({ principalId: 'bob', invitation: { id: 'i', epoch: 1 } })],
      ['draft/page', page({ files: [] })], ['draft/page', page({ files: [file('../x', 'a')] })],
      ['draft/page', page({ files: [{ ...file('a', 'a'), mode: 0o777 }] })], ['draft/page', page({ files: [{ ...file('a', 'a'), data: 'YQ' }] })],
      ['draft/seal', { artifactId: key.artifactId, bindingGeneration: 1, revision: 'r1', pages: 0, baseHeadSha: 'B', treeSha: TREE, deletes: [] }],
    ];
    for (const [path, body] of invalid) expect([path, (await s.call(path, body)).status]).toEqual([path, 400]);
    expect((await s.call('reconcile', reconcile({ ownerId: 'x'.repeat(2048) }))).status).toBe(413);
    expect((await s.call('draft/page', page({ files: [file('a', 'x'.repeat(2 * 1024 * 1024))] }))).status).toBe(413);
    const big = await s.call('draft/page', page({ files: [file('a', 'x'.repeat(1024 * 1024 + 1))] }));
    expect(big.status).toBe(413); expect(await big.json()).toEqual({ error: 'limit_exceeded' });
    expect((await s.call('draft/page', page({ page: 32 }))).status).toBe(413);
    expect((await s.call('draft/page', page({ page: 1 }))).status).toBe(409);
    expect((await s.call('draft/page', page({}))).status).toBe(204);
    const overlap = await s.call('draft/seal', { artifactId: key.artifactId, bindingGeneration: 1, revision: 'r1', pages: 1,
      baseHeadSha: HEAD, treeSha: TREE, deletes: ['a.txt'] });
    expect(overlap.status).toBe(400); expect(await overlap.json()).toEqual({ error: 'invalid_request', reason: 'duplicate_path' });
  });
});
