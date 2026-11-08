import { describe, expect, it } from 'vitest';
import { key, memoryRows } from './fixture';
import { createRemoteDrafts } from '../../../src/services/artifacts/live/remote-drafts';
import { createRemoteLive, rowOf } from '../../../src/services/artifacts/live/remote-live';
import { podName } from '../../../src/services/artifacts/live/pods';
import type { LiveRuntime } from '../../../src/services/artifacts/live/records';

const HEAD = 'b'.repeat(40); const TREE = 'c'.repeat(40);
const text = (path: string, value: string) => ({ path, mode: 0o644, bytes: new Uint8Array(Buffer.from(value)) });
const runtime = { generation: 1, podName: podName(key) } as LiveRuntime;
const seal = (revision: string, pages: number, deletes: string[] = []) =>
  ({ generation: 1, revision, pages, baseHeadSha: HEAD, treeSha: TREE, deletes });
function setup() {
  const rows = memoryRows();
  return { rows, d: createRemoteDrafts(rows), live: createRemoteLive(rows) };
}
const restored = async (d: ReturnType<typeof createRemoteDrafts>, revision: string) => {
  const { files, deletes } = await d.draft(runtime, { generation: 1, revision, baseHeadSha: HEAD, treeSha: TREE, dirty: true });
  return { files: files.map(f => [f.path, f.mode, Buffer.from(f.bytes).toString()]), deletes };
};

describe('remote drafts (D0 staging)', () => {
  it('should restore the exact sealed overlay, pages in order, with its deletions', async () => {
    const { d } = setup();
    await d.page(key, { generation: 1, revision: 'r1', page: 0, files: [text('a.ts', 'A')] });
    await d.page(key, { generation: 1, revision: 'r1', page: 1, files: [text('b.ts', 'B'), { ...text('run.sh', 'x'), mode: 0o755 }] });
    await d.seal(key, seal('r1', 2, ['old.ts']));
    expect(await d.drafts.current(key, 1)).toEqual({ generation: 1, revision: 'r1', baseHeadSha: HEAD, treeSha: TREE, dirty: true });
    expect(await restored(d, 'r1')).toEqual({ files: [['a.ts', 0o644, 'A'], ['b.ts', 0o644, 'B'], ['run.sh', 0o755, 'x']], deletes: ['old.ts'] });
  });
  it('should seal a clean draft without pages and refuse an unstaged or other-generation read', async () => {
    const { d } = setup();
    await expect(d.drafts.current(key, 1)).rejects.toMatchObject({ reason: 'draft_not_staged' });
    await d.seal(key, seal('clean', 0));
    expect(await d.drafts.current(key, 1)).toMatchObject({ revision: 'clean', dirty: false });
    await expect(d.drafts.current(key, 2)).rejects.toMatchObject({ reason: 'stale_fence' });
    await expect(d.seal(key, { ...seal('clean', 0), generation: 0 })).rejects.toMatchObject({ reason: 'stale_fence' });
  });
  it('should stage the next revision beside the sealed one, which stays readable until the seal', async () => {
    const { d } = setup();
    await d.page(key, { generation: 1, revision: 'r1', page: 0, files: [text('a.ts', 'A1')] }); await d.seal(key, seal('r1', 1));
    await d.page(key, { generation: 1, revision: 'r2', page: 0, files: [text('a.ts', 'A2')] });
    expect((await d.drafts.current(key, 1)).revision).toBe('r1');
    expect((await restored(d, 'r1')).files).toEqual([['a.ts', 0o644, 'A1']]);
    await d.seal(key, seal('r2', 1));
    expect((await restored(d, 'r2')).files).toEqual([['a.ts', 0o644, 'A2']]);
    await expect(restored(d, 'r1')).rejects.toMatchObject({ reason: 'stale_fence' });
  });
  it('should fail closed on a page overwritten after the seal', async () => {
    const { d, rows } = setup();
    await d.page(key, { generation: 1, revision: 'r1', page: 0, files: [text('a.ts', 'A')] }); await d.seal(key, seal('r1', 1));
    const row = (await rows.read<{ sealed: { slot: number } }>(rowOf(podName(key), 'draft')))!;
    await rows.update(rowOf(podName(key), 'page', row.sealed.slot, 0), () => ({ next: [{ path: 'a.ts', mode: 0o644, data: 'Qg==' }], result: 0 }));
    await expect(restored(d, 'r1')).rejects.toMatchObject({ reason: 'stale_fence' });
  });
  it('should take pages in order, replay the last page and seal idempotently', async () => {
    const { d } = setup(); const first = { generation: 1, revision: 'r1', page: 0, files: [text('a.ts', 'A')] };
    await d.page(key, first); await d.page(key, first);
    await expect(d.page(key, { ...first, page: 2 })).rejects.toMatchObject({ reason: 'staging_moved' });
    await expect(d.page(key, { ...first, page: 1 })).rejects.toMatchObject({ code: 'invalid_request', reason: 'duplicate_path' });
    await expect(d.seal(key, seal('r1', 2))).rejects.toMatchObject({ reason: 'staging_moved' });
    await d.seal(key, seal('r1', 1)); await d.seal(key, seal('r1', 1));
    await expect(d.page(key, { ...first, page: 1, files: [text('b.ts', 'B')] })).rejects.toMatchObject({ reason: 'staging_moved' });
  });
  it('should bound the overlay at 255 paths and 8 MiB across pages', async () => {
    const { d } = setup(); const many = Array.from({ length: 200 }, (_, i) => text(`f${i}`, 'x'));
    await d.page(key, { generation: 1, revision: 'r1', page: 0, files: many });
    await expect(d.page(key, { generation: 1, revision: 'r1', page: 1, files: Array.from({ length: 56 }, (_, i) => text(`g${i}`, 'x')) }))
      .rejects.toMatchObject({ code: 'limit_exceeded' });
    await expect(d.seal(key, seal('r1', 1, Array.from({ length: 56 }, (_, i) => `h${i}`)))).rejects.toMatchObject({ code: 'limit_exceeded' });
    const mib = (i: number) => [text(`m${i}`, 'x'.repeat(1024 * 1024))];
    for (let i = 0; i < 8; i++) await d.page(key, { generation: 1, revision: 'big', page: i, files: mib(i) });
    await expect(d.page(key, { generation: 1, revision: 'big', page: 8, files: [text('one', 'y')] })).rejects.toMatchObject({ code: 'limit_exceeded' });
  });
  it('should leave the draft to the host: no clean advance, and a checkpoint verifies the sealed revision', async () => {
    const { d } = setup(); await d.seal(key, seal('r1', 0));
    const draft = await d.drafts.current(key, 1);
    await expect(d.drafts.advanceClean(key, draft, 'd'.repeat(40))).rejects.toMatchObject({ code: 'git_live_draft_conflict' });
    await expect(d.drafts.checkpoint(key, draft)).resolves.toBeUndefined();
    await d.seal(key, seal('r2', 0));
    await expect(d.drafts.checkpoint(key, draft)).rejects.toMatchObject({ code: 'git_live_revision_moved' });
  });
  it('should keep the package fences monotonic and the last session invitation state per generation', async () => {
    const { live } = setup(); const s = { generation: 1, ownerId: 'owner', liveSessionId: 's1', leaseEpoch: 2, routeEpoch: 3 };
    await expect(live.session(key)).rejects.toMatchObject({ reason: 'stale_session' });
    await live.reconciled(key, s);
    expect(await live.invitations.current(key, 1)).toEqual({ epoch: 0, expiresAt: null });
    await live.invitation(key, 1, { epoch: 2, expiresAt: 5000 });
    await live.invitation(key, 1, { epoch: 2, expiresAt: 4000 });
    expect(await live.invitations.current(key, 1)).toEqual({ epoch: 2, expiresAt: 4000 });
    await expect(live.invitation(key, 1, { epoch: 1, expiresAt: null })).rejects.toMatchObject({ reason: 'stale_invitation' });
    expect(await live.invitations.current(key, 1)).toEqual({ epoch: 2, expiresAt: 4000 });
    await live.reconciled(key, { ...s, liveSessionId: 's2', leaseEpoch: 3, routeEpoch: 1 });
    await expect(live.reconciled(key, s)).rejects.toMatchObject({ reason: 'stale_session' });
    await live.reconciled(key, { ...s, generation: 2, leaseEpoch: 1 });
    expect(await live.invitations.current(key, 2)).toEqual({ epoch: 0, expiresAt: null });
    await live.invitation(key, 2, { epoch: 1, expiresAt: null });
    expect(await live.invitations.current(key, 1)).toEqual({ epoch: 2, expiresAt: 4000 });
    expect(await live.session(key)).toMatchObject({ generation: 2, ownerId: 'owner' });
    await expect(live.fences(key, 1)).rejects.toMatchObject({ reason: 'stale_session' });
    expect(await live.fences(key, 2)).toEqual({ liveSessionId: 's1', leaseEpoch: 1, routeEpoch: 3 });
  });
});
