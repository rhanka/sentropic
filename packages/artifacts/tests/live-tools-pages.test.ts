import { expect, it } from 'vitest';
import { liveWitness } from './fixtures/live-world.js';

it('should reconstruct a complete paged delta and expire a cursor rather than mix source revisions', async () => {
  const w = liveWitness();
  await w.write({ files: Array.from({ length: 40 }, (_, i) => ({ path: `ui/new-${String(i).padStart(2, '0')}.ts`, text: 'value-' + i })) });
  const first = await w.call('live_status', { includeDiff: true });
  expect(first.files).toHaveLength(32);
  const second = await w.call('live_status', { includeDiff: true, cursor: first.nextCursor });
  expect(second.files).toHaveLength(8); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.files, ...second.files].map(f => f.path)).size).toBe(40);
  await w.write({ files: [{ path: 'ui/new-00.ts', text: 'newer' }] });
  await expect(w.call('live_status', { includeDiff: true, cursor: first.nextCursor }))
    .rejects.toMatchObject({ kind: 'git_live_snapshot_expired' });
});
it('should renew a restored draft only after the matching projection ACK and never on polling', async () => {
  let clock = Date.parse('2026-11-06T12:00:00Z');
  const w = liveWitness({ now: () => clock });
  const written = await w.write({ files: [{ path: 'ui/a.ts', text: 'retained' }] });
  await w.call('live_control', { action: 'stop', liveSessionId: written.liveSessionId,
    expectedLiveRevision: written.liveRevision, idempotencyKey: 'stop' });
  clock += 3600000;
  expect((await w.status()).draftExpiresAt).toBe(written.draftExpiresAt);
  w.worker.reconcile.mockImplementation(async identity => {
    const record = await w.store.transaction(identity, async tx => tx.record!);
    return { liveSessionId: record.runtime!.liveSessionId, leaseEpoch: record.runtime!.leaseEpoch,
      routeEpoch: record.runtime!.routeEpoch, revision: record.revision, ready: true };
  });
  const state = await w.status();
  const start = await w.call('live_control', { action: 'start', expectedHeadSha: state.currentHeadSha,
    expectedLiveRevision: state.liveRevision, idempotencyKey: 'start' });
  await new Promise<void>(resolve => setImmediate(resolve));
  const ready = await w.status();
  expect(ready.appliedRevision).toBe(start.liveRevision);
  expect(ready.draftExpiresAt > written.draftExpiresAt).toBe(true);
  expect((await w.call('live_read')).files[0].text).toBe('retained');
  expect((await w.status()).liveRevision).toBe(start.liveRevision);
});
it('should acknowledge a durable edit even when cold worker startup is still pending', async () => {
  const w = liveWitness();
  w.worker.reconcile.mockImplementation(() => new Promise(() => undefined));
  const write = w.write({ files: [{ path: 'ui/a.ts', text: 'durable before startup' }] });
  const accepted = await Promise.race([write.then(() => true), new Promise(resolve => setImmediate(() => resolve(false)))]);
  expect(accepted).toBe(true);
  expect(await write).toMatchObject({ workerPending: true, appliedRevision: null });
  expect((await w.call('live_read')).files[0].text).toBe('durable before startup');
});
it('should refuse stale or differently scoped readers and unsupported control combinations', async () => {
  const w = liveWitness(); const state = await w.status();
  for (const args of [{ action: 'start', liveSessionId: 'wrong' }, { action: 'stop', expectedHeadSha: state.currentHeadSha }]) {
    await expect(w.call('live_control', { ...args, idempotencyKey: 'bad' })).rejects.toMatchObject({ kind: 'invalid_request' });
  }
  await expect(w.service.execute('live_read', { artifactId: w.binding.artifactId }, { ...w.context, storageScopeId: 'other' }))
    .rejects.toMatchObject({ kind: 'access_denied' });
  await expect(w.service.execute('live_read', { artifactId: w.binding.artifactId }, { ...w.context, actorId: 'bob' }))
    .rejects.toMatchObject({ kind: 'access_denied' });
});
