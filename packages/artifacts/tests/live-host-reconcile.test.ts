import { describe, expect, it, vi } from 'vitest';
import { createMemoryGitBindingStore } from '../src/server/git-bindings.js';
import { jobKey, type HandoffReceipt } from '../src/live-host/handoff.js';
import {
  parseReconcileBuilderStatus, reconcilePendingBuild, reconcilePendingBuilds, ReconcileError,
} from '../src/live-host/reconcile.js';
import { ARTIFACT, attachedBindings, buildPendingBindings, JOB, reconcileJobStore, reconcileStatusClient, SCOPE } from './fixtures/live-host-reconcile.js';

const key = { scopeId: SCOPE, artifactId: ARTIFACT, jobId: JOB };
const failed = { jobId: JOB, state: 'build_failed' as const, code: 'build_failed', reason: 'unit tests failed' };
const receipt = (releaseId: string) => ({ releaseId } as unknown as HandoffReceipt);

describe('live-host pending build reconcile (stuck build_pending/building)', () => {
  it('marks a stale failed build and moves the binding from build_pending to build_failed', async () => {
    const { store } = reconcileJobStore({ [JSON.stringify([SCOPE, ARTIFACT, JOB])]: { state: 'building', updatedAtMs: 0 } });
    const { client } = reconcileStatusClient({ [JOB]: failed });
    const bindings = await buildPendingBindings();
    const report = await reconcilePendingBuilds({ jobs: store, status: client, bindings, now: () => 3_600_000 });
    expect(report).toMatchObject({ checked: 1, updated: 1 });
    expect(report.items[0]).toMatchObject({ ...key, outcome: 'job-build-failed', job: 'updated', binding: 'updated' });
    expect(await store.read(key)).toMatchObject({ state: 'build_failed', code: 'build_failed', reason: 'unit tests failed' });
    expect(await bindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'build_failed', version: 3, pendingJobId: JOB });
    // A rerun is idempotent: the terminal row is never regressed and the binding is untouched.
    const again = await reconcilePendingBuilds({ jobs: store, status: client, bindings, now: () => 7_200_000 });
    expect(again.items).toEqual([]);
    expect(await bindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'build_failed', version: 3 });
  });

  it('applies the receipt releaseId on builder published and never invents a release', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const receipts = { find: async (job: string) => job === jobKey(key) ? receipt('release-receipt') : undefined };
    // The stored handoff receipt supplies the releaseId when the builder status carries none, but the
    // still-pending binding is reported: the host publish transaction owns that transition.
    const first = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const publishedBindings = await buildPendingBindings();
    const out = await reconcilePendingBuild({ jobs: first.store,
      status: reconcileStatusClient({ [JOB]: { jobId: JOB, state: 'published' } }).client,
      bindings: publishedBindings, receipts }, key);
    expect(out).toMatchObject({ outcome: 'binding-not-pending', job: 'updated', binding: 'unchanged' });
    expect(await first.store.read(key)).toMatchObject({ state: 'published', releaseId: 'release-receipt' });
    expect(await publishedBindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'build_pending', version: 2 });
    // When the host publish path already moved the binding on, the job close is clean.
    const moved = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const clean = await reconcilePendingBuild({ jobs: moved.store,
      status: reconcileStatusClient({ [JOB]: { jobId: JOB, state: 'published', releaseId: 'release-receipt' } }).client,
      bindings: await attachedBindings(), receipts }, key);
    expect(clean).toMatchObject({ outcome: 'job-published', job: 'updated', binding: 'unchanged' });

    // Without a receipt and without a status releaseId, nothing is invented.
    const second = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const bare = await reconcilePendingBuild({ jobs: second.store,
      status: reconcileStatusClient({ [JOB]: { jobId: JOB, state: 'published' } }).client,
      bindings: await buildPendingBindings() }, key);
    expect(bare.outcome).toBe('no-release');
    expect(await second.store.read(key)).toMatchObject({ state: 'building' });

    // A receipt that disagrees with the builder status fails closed.
    const third = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const conflict = await reconcilePendingBuild({ jobs: third.store,
      status: reconcileStatusClient({ [JOB]: { jobId: JOB, state: 'published', releaseId: 'release-other' } }).client,
      bindings: await buildPendingBindings(), receipts }, key);
    expect(conflict.outcome).toBe('receipt-conflict');
    expect(await third.store.read(key)).toMatchObject({ state: 'building' });
  });

  it('leaves a still-pending build untouched and skips malformed statuses', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const { store } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const bindings = await buildPendingBindings();
    const pending = await reconcilePendingBuild({ jobs: store,
      status: reconcileStatusClient({ [JOB]: { jobId: JOB, state: 'build_pending' } }).client, bindings }, key);
    expect(pending).toMatchObject({ outcome: 'still-pending', job: 'unchanged', binding: 'unchanged' });
    for (const bad of [{ jobId: 'other', state: 'build_failed', code: 'x' }, { jobId: JOB, state: 'exploded' },
      { jobId: JOB, state: 'published', releaseId: '' }, { jobId: JOB, state: 'build_failed', code: '' }]) {
      const out = await reconcilePendingBuild({ jobs: store,
        status: reconcileStatusClient({ [JOB]: bad as never }).client, bindings }, key);
      expect(out.outcome).toBe('status-invalid');
    }
    expect(await store.read(key)).toMatchObject({ state: 'building' });
    expect(await bindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'build_pending', version: 2 });
    expect(parseReconcileBuilderStatus({ jobId: JOB, state: 'build_failed' }, JOB)).toEqual({ jobId: JOB, state: 'build_failed' });
    expect(parseReconcileBuilderStatus({ jobId: JOB, state: 'published' }, 'other')).toBeUndefined();
  });

  it('never regresses terminal rows, deletes nothing on unknown jobs, and survives transport failures', async () => {
    const status = vi.fn(async ({ jobId }: { jobId: string }) => {
      if (jobId === 'down') throw new Error('transport down');
      return undefined;
    });
    const rows: Record<string, { state: string; updatedAtMs: number }> = {
      [JSON.stringify([SCOPE, ARTIFACT, 'done'])]: { state: 'published', updatedAtMs: 0 },
      [JSON.stringify([SCOPE, ARTIFACT, 'down'])]: { state: 'building', updatedAtMs: 0 },
      [JSON.stringify([SCOPE, ARTIFACT, 'gone'])]: { state: 'building', updatedAtMs: 0 },
    };
    const { store } = reconcileJobStore(rows);
    const bindings = await buildPendingBindings();
    // The sweep lists pending rows only, so the terminal row is not swept; it is read on demand instead.
    const report = await reconcilePendingBuilds({ jobs: store, status: { status }, bindings });
    expect(report.items).toMatchObject([
      { jobId: 'down', outcome: 'status-unavailable', job: 'unchanged' },
      { jobId: 'gone', outcome: 'unknown-job', job: 'unchanged' },
    ]);
    const done = await reconcilePendingBuild({ jobs: store, status: { status }, bindings }, { ...key, jobId: 'done' });
    expect(done).toMatchObject({ outcome: 'already-terminal', job: 'unchanged' });
    expect(status).toHaveBeenCalledTimes(2);
    expect(await store.read({ ...key, jobId: 'done' })).toMatchObject({ state: 'published' });
  });

  it('updates the job but keeps a superseded binding, and reports a binding conflict', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const { store } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    // The success path already moved the binding on to attached: only the stale job row moves.
    const moved = await attachedBindings();
    const out = await reconcilePendingBuild({ jobs: store, status: reconcileStatusClient({ [JOB]: failed }).client, bindings: moved }, key);
    expect(out).toMatchObject({ outcome: 'job-build-failed', job: 'updated', binding: 'unchanged' });
    expect(await store.read(key)).toMatchObject({ state: 'build_failed' });
    expect(await moved.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'attached', version: 1 });

    // A concurrent move of the binding between the read and the write reports binding-conflict.
    const { store: racing } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const bindings = await buildPendingBindings();
    const before = (await bindings.get(SCOPE, ARTIFACT))!;
    const write = bindings.write.bind(bindings);
    let raced = false;
    bindings.write = (async (input: Parameters<typeof write>[0]) => {
      if (!raced) {
        raced = true;
        await write({ binding: { ...before, state: 'build_failed' as const, version: before.version + 1, updatedAt: before.updatedAt },
          expectedVersion: before.version, actorId: 'alice', idempotencyKey: 'racer', commandHash: 'racer',
          event: { action: 'publish', invocationId: 'race' } });
      }
      return write(input);
    }) as typeof write;
    const conflict = await reconcilePendingBuild({ jobs: racing,
      status: reconcileStatusClient({ [JOB]: failed }).client, bindings }, key);
    expect(conflict).toMatchObject({ outcome: 'binding-conflict', job: 'updated', binding: 'unchanged' });
  });

  it('contains a poison item and converges after a crash between the two writes', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    // A host-store outage on one item is data, and the sweep still attempts the next item.
    const rows: Record<string, { state: string; updatedAtMs: number }> = {
      [JSON.stringify([SCOPE, ARTIFACT, 'job-a'])]: { state: 'building', updatedAtMs: 0 },
      [JSON.stringify([SCOPE, ARTIFACT, 'job-b'])]: { state: 'building', updatedAtMs: 0 },
    };
    const { store } = reconcileJobStore(rows);
    const failing = store.read.bind(store);
    store.read = (async (input: { jobId: string }) => {
      if (input.jobId === 'job-a') throw new Error('store down for job-a');
      return failing(input as never);
    }) as typeof store.read;
    const bothFailed = { 'job-a': { jobId: 'job-a', state: 'build_failed' as const, code: 'x' },
      'job-b': { jobId: 'job-b', state: 'build_failed' as const } };
    const report = await reconcilePendingBuilds({ jobs: store,
      status: reconcileStatusClient(bothFailed as never).client, bindings: await buildPendingBindings(ARTIFACT, 'job-b') });
    expect(report.items).toMatchObject([
      { jobId: 'job-a', outcome: 'store-error', job: 'unchanged', binding: 'unchanged' },
      { jobId: 'job-b', outcome: 'job-build-failed', job: 'updated', binding: 'updated' },
    ]);
    // A crash after the binding write still converges: a rerun finds the job pending and finishes it.
    const crash = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const bindings = await buildPendingBindings();
    const mark = crash.store.markFailed.bind(crash.store);
    let crashed = false;
    crash.store.markFailed = (async (input: never) => {
      if (!crashed) { crashed = true; throw new Error('crash between the writes'); }
      return mark(input);
    }) as typeof crash.store.markFailed;
    const options = { jobs: crash.store, status: reconcileStatusClient({ [JOB]: failed }).client, bindings };
    const lost = await reconcilePendingBuild(options, key);
    expect(lost).toMatchObject({ outcome: 'store-error', job: 'unchanged', binding: 'updated' });
    const rerun = await reconcilePendingBuild(options, key);
    expect(rerun).toMatchObject({ outcome: 'job-build-failed', job: 'updated', binding: 'unchanged' });
    expect(await bindings.events(SCOPE, ARTIFACT)).toHaveLength(3);
  });

  it('codes a codeless builder failure, audits the binding event and reads missing rows as not-found', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const { store } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const bindings = await buildPendingBindings();
    const out = await reconcilePendingBuild({ jobs: store,
      status: reconcileStatusClient({ [JOB]: { jobId: JOB, state: 'build_failed' } }).client, bindings }, key);
    expect(out).toMatchObject({ outcome: 'job-build-failed', job: 'updated', binding: 'updated' });
    expect(await store.read(key)).toMatchObject({ state: 'build_failed', code: 'builder_unavailable' });
    const events = await bindings.events(SCOPE, ARTIFACT);
    expect(events.map(event => event.action)).toEqual(['attach', 'publish', 'publish']);
    expect(events[2]).toMatchObject({ actorId: 'system:reconcile-pending-builds', invocationId: 'reconcile:job-1' });
    // A paused binding and a missing binding never move; the job still closes per builder truth.
    const paused = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const pausing = await attachedBindings();
    const current = (await pausing.get(SCOPE, ARTIFACT))!;
    await pausing.write({ binding: { ...current, state: 'paused', generation: 2, version: 2, updatedAt: current.updatedAt },
      expectedVersion: 1, actorId: 'alice', idempotencyKey: 'pause-1', commandHash: 'pause-1', event: { action: 'pause' } });
    const kept = await reconcilePendingBuild({ jobs: paused.store,
      status: reconcileStatusClient({ [JOB]: failed }).client, bindings: pausing }, key);
    expect(kept).toMatchObject({ outcome: 'job-build-failed', job: 'updated', binding: 'unchanged' });
    const missing = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const gone = await reconcilePendingBuild({ jobs: missing.store,
      status: reconcileStatusClient({ [JOB]: failed }).client, bindings: createMemoryGitBindingStore() }, key);
    expect(gone).toMatchObject({ outcome: 'job-build-failed', job: 'updated', binding: 'unchanged' });
    // A row the host never recorded is not-found without calling the builder.
    const calls = reconcileStatusClient({ [JOB]: failed });
    const fresh = reconcileJobStore({});
    expect(await reconcilePendingBuild({ jobs: fresh.store, status: calls.client,
      bindings: createMemoryGitBindingStore() }, key)).toMatchObject({ outcome: 'job-not-found' });
    expect(calls.load()).toBe(0);
  });

  it('treats the builder status as bounded: extra keys ignored, whitespace-only code stored', async () => {
    expect(parseReconcileBuilderStatus({ jobId: JOB, state: 'build_failed', code: '  ', extra: 1 }, JOB))
      .toEqual({ jobId: JOB, state: 'build_failed', code: '  ' });
    expect(parseReconcileBuilderStatus({ jobId: JOB, state: 'published', releaseId: '' }, JOB)).toBeUndefined();
  });

  it('sweeps only stale jobs with bounded concurrency and fails closed on bad options', async () => {
    const rows: Record<string, { state: string; updatedAtMs: number }> = {};
    for (let n = 0; n < 10; n++) {
      rows[JSON.stringify([SCOPE, ARTIFACT, `job-${n}`])] = { state: 'building', updatedAtMs: n * 60_000 };
    }
    const { store } = reconcileJobStore(rows);
    const answers: Record<string, { jobId: string; state: 'build_failed'; code: string }> = {};
    for (let n = 0; n < 10; n++) answers[`job-${n}`] = { jobId: `job-${n}`, state: 'build_failed', code: 'x' };
    const { client, load } = reconcileStatusClient(answers);
    const report = await reconcilePendingBuilds({ jobs: store, status: client, bindings: await buildPendingBindings(),
      now: () => 600_000, olderThanMs: 300_000, limit: 5, concurrency: 2 });
    expect(report.checked).toBe(5);
    expect(load()).toBeLessThanOrEqual(2);
    expect(report.items.map(item => item.jobId)).toEqual(['job-0', 'job-1', 'job-2', 'job-3', 'job-4']);
    await expect(reconcilePendingBuilds({ jobs: store, status: client, bindings: await buildPendingBindings(), concurrency: 0 }))
      .rejects.toBeInstanceOf(ReconcileError);
    await expect(reconcilePendingBuild({ jobs: store, status: client, bindings: await buildPendingBindings() },
      { scopeId: '', artifactId: ARTIFACT, jobId: JOB })).rejects.toBeInstanceOf(ReconcileError);
  });
});
