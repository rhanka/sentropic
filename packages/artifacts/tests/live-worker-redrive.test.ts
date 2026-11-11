import { expect, it } from 'vitest';
import { liveWitness } from './fixtures/live-world.js';
import { ArtifactOperationError } from '../src/server/failures.js';
import type { LiveWorkerEvent } from '../src/server/live-contracts.js';
import { createMemoryLiveStore, liveWorkerPending, type LiveIdentity } from '../src/server/live-store.js';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function world() {
  const events: LiveWorkerEvent[] = [];
  const w = liveWitness({ onWorkerEvent: event => events.push(event) });
  const identity: LiveIdentity = { storageScopeId: w.context.storageScopeId, artifactId: w.binding.artifactId, bindingGeneration: 1 };
  const record = () => w.store.transaction(identity, async tx => tx.record!);
  /** Builder answer with the current package fences, as the product bridge echoes them. */
  const builder = (ready: boolean) => w.worker.reconcile.mockImplementation(async () => {
    const row = await record();
    return { liveSessionId: row.runtime!.liveSessionId, leaseEpoch: row.runtime!.leaseEpoch, routeEpoch: row.runtime!.routeEpoch,
      revision: row.revision, ready };
  });
  const start = async (key: string) => {
    const state = await w.status();
    return w.call('live_control', { action: 'start', expectedHeadSha: state.currentHeadSha,
      expectedLiveRevision: state.liveRevision, idempotencyKey: key });
  };
  return { w, events, identity, record, builder, start, scope: w.context.storageScopeId };
}

it('should report a not-ready worker and reach LIVE on a later re-drive', async () => {
  const { w, events, identity, record, builder, start, scope } = world();
  builder(false);
  expect(await start('start')).toMatchObject({ state: 'REVIVING', workerPending: true });
  await settle();
  expect(events).toEqual([{ identity, action: 'project', outcome: 'pending' }]);
  expect((await record()).runtime!.phase).toBe('REVIVING');
  expect(await w.service.redrive(scope)).toEqual([{ ...identity, action: 'project', outcome: 'pending' }]);
  builder(true);
  expect(await w.service.redrive(scope)).toEqual([{ ...identity, action: 'project', outcome: 'settled' }]);
  const row = await record();
  expect(row.runtime).toMatchObject({ phase: 'LIVE', appliedRevision: row.revision });
  expect(await w.service.redrive(scope)).toEqual([]);
});

it('should report a worker refusal with its typed code and recover it on re-drive, as after a process restart', async () => {
  const { w, events, identity, record, builder, start, scope } = world();
  w.worker.reconcile.mockRejectedValueOnce(new ArtifactOperationError('provider_unavailable'));
  await start('start'); await settle();
  expect(events).toEqual([{ identity, action: 'project', outcome: 'failed', code: 'provider_unavailable' }]);
  expect((await record()).runtime!.phase).toBe('REVIVING');
  builder(true);
  expect(await w.service.redrive(scope)).toEqual([{ ...identity, action: 'project', outcome: 'settled' }]);
  expect((await record()).runtime!.phase).toBe('LIVE');
});

it('should never let a throwing observer change the outcome', async () => {
  const w = liveWitness({ onWorkerEvent: () => { throw new Error('observer'); } });
  w.worker.reconcile.mockRejectedValue(new ArtifactOperationError('builder_unavailable'));
  const written = await w.write({ files: [{ path: 'ui/a.ts', text: 'kept' }] });
  await settle();
  expect(written).toMatchObject({ workerPending: true });
  expect(await w.service.redrive(w.context.storageScopeId)).toMatchObject([{ action: 'project', outcome: 'failed' }]);
});

it('should join a reviving explicit session on a second start instead of refusing it', async () => {
  const { w, record, builder, start } = world();
  builder(false);
  const first = await start('start-1'); await settle();
  const second = await start('start-2'); await settle();
  expect(second).toMatchObject({ liveSessionId: first.liveSessionId, state: 'REVIVING', replayed: false });
  expect(w.worker.reconcile).toHaveBeenCalledTimes(2);
  expect((await record()).runtime).toMatchObject({ liveSessionId: first.liveSessionId, leaseEpoch: 1, origin: 'explicit' });
  builder(true);
  const third = await start('start-3'); await settle();
  expect(third.liveSessionId).toBe(first.liveSessionId);
  expect((await record()).runtime!.phase).toBe('LIVE');
  await expect(start('start-4')).rejects.toMatchObject({ kind: 'git_live_conflict', details: { publicDetails: { reason: 'active_session' } } });
});

it('should finish on re-drive a stop the worker refused, instead of staying QUIESCING', async () => {
  const { w, events, identity, record, builder, start, scope } = world();
  builder(true);
  const started = await start('start'); await settle();
  w.worker.stop.mockRejectedValueOnce(new ArtifactOperationError('provider_unavailable'));
  const state = await w.status();
  const stopped = await w.call('live_control', { action: 'stop', liveSessionId: started.liveSessionId,
    expectedLiveRevision: state.liveRevision, idempotencyKey: 'stop' });
  expect(stopped.state).toBe('QUIESCING');
  expect(events.at(-1)).toEqual({ identity, action: 'stop', outcome: 'failed', code: 'provider_unavailable' });
  expect(await w.service.redrive(scope)).toEqual([{ ...identity, action: 'stop', outcome: 'settled' }]);
  expect((await record()).runtime).toMatchObject({ phase: 'DORMANT', appliedRevision: null });
  expect(await w.service.redrive(scope)).toEqual([]);
});

it('should list only the runtimes of the scope that wait for the worker', async () => {
  const store = createMemoryLiveStore();
  const seed = (scope: string, artifactId: string, phase: string, applied: string | null, lastAccessAt: string) =>
    store.transaction({ storageScopeId: scope, artifactId, bindingGeneration: 1 }, async tx => {
      tx.record = { storageScopeId: scope, artifactId, bindingGeneration: 1, revision: 'r1',
        runtime: { phase, appliedRevision: applied, lastAccessAt, liveSessionId: 's-' + artifactId } } as never;
    });
  await seed('scope-a', 'reviving', 'REVIVING', null, '2026-11-11T02:00:00.000Z');
  await seed('scope-a', 'quiescing', 'QUIESCING', null, '2026-11-11T01:00:00.000Z');
  await seed('scope-a', 'behind', 'LIVE', 'r0', '2026-11-11T03:00:00.000Z');
  await seed('scope-a', 'live', 'LIVE', 'r1', '2026-11-11T00:00:00.000Z');
  await seed('scope-a', 'dormant', 'DORMANT', null, '2026-11-11T00:00:00.000Z');
  await seed('scope-b', 'other', 'REVIVING', null, '2026-11-11T00:00:00.000Z');
  expect((await store.pending!('scope-a')).map(identity => identity.artifactId)).toEqual(['quiescing', 'reviving', 'behind']);
  expect((await store.pending!('scope-a', 1)).map(identity => identity.artifactId)).toEqual(['quiescing']);
  expect(liveWorkerPending(undefined)).toBeNull();
});

it('should admit live writers on a build_failed binding and still refuse a pending build', async () => {
  const w = liveWitness();
  Object.assign(w.binding, { state: 'build_failed', pendingJobId: '99999999-9999-4999-8999-999999999999' });
  const written = await w.write({ files: [{ path: 'ui/a.ts', text: 'repair' }] });
  expect(written).toMatchObject({ state: 'REVIVING' });
  const committed = await w.call('git_commit', { expectedHeadSha: written.currentHeadSha, message: 'Repair', idempotencyKey: 'repair',
    files: [{ path: 'ui/a.ts', text: 'repair' }] });
  expect(committed.commitSha).toBe('c'.repeat(40));
  w.binding.state = 'build_pending';
  await expect(w.write({ files: [{ path: 'ui/b.ts', text: 'later' }] }))
    .rejects.toMatchObject({ kind: 'git_live_conflict', details: { publicDetails: { reason: 'pending_publication' } } });
});
