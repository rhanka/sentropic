import { describe, expect, it, vi } from 'vitest';
import { createMemoryGitBindingStore } from '../src/server/git-bindings.js';
import { jobKey, type HandoffReceipt } from '../src/live-host/handoff.js';
import {
  parseReconcileBuilderStatus, reconcilePendingBuild, reconcilePendingBuilds, ReconcileError,
  type ReconcileJobStore,
} from '../src/live-host/reconcile.js';
import { ARTIFACT, attachedBindings, buildPendingBindings, JOB, reconcileJobStore, reconcileStatusClient, SCOPE, SHA } from './fixtures/live-host-reconcile.js';

const key = { scopeId: SCOPE, artifactId: ARTIFACT, jobId: JOB };
const failed = { jobId: JOB, state: 'build_failed' as const, code: 'build_failed', reason: 'unit tests failed' };
const receipt = (releaseId: string, commitSha = SHA): HandoffReceipt => ({ v: 1, kid: 'test-kid', nonce: 'test-nonce',
  scopeId: SCOPE, artifactId: ARTIFACT, jobId: JOB, runId: 'run-1', attempt: 1, commitSha, candidateDigest: 'digest',
  releaseId, manifestDigest: 'manifest', committedAt: 1, signature: 'signature' });

describe('live-host pending build reconcile (stuck build_pending/building)', () => {
  it('marks a stale failed build and moves the binding from build_pending to build_failed', async () => {
    const { store } = reconcileJobStore({ [JSON.stringify([SCOPE, ARTIFACT, JOB])]: { state: 'building', updatedAtMs: 0 } });
    const { client } = reconcileStatusClient({ [JOB]: failed });
    const bindings = await buildPendingBindings();
    const report = await reconcilePendingBuilds({ jobs: store, status: client, bindings, now: () => 3_600_000 });
    expect(report).toMatchObject({ checked: 1, updated: 1 });
    expect(report.items[0]).toMatchObject({ ...key, outcome: 'job-build-failed', job: 'updated', binding: 'updated' });
    expect(await store.read(key)).toMatchObject({ state: 'build_failed', code: 'build_failed', reason: 'unit tests failed' });
    expect(await bindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'build_failed', version: 3, pendingJobId: JOB,
      stateDetail: 'build_failed' });
    // A rerun is idempotent: the terminal row is never regressed and the binding is untouched.
    const again = await reconcilePendingBuilds({ jobs: store, status: client, bindings, now: () => 7_200_000 });
    expect(again.items).toEqual([]);
    expect(await bindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'build_failed', version: 3 });
  });

  it('applies the receipt releaseId on builder published and never invents a release', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const receipts = { find: async (job: string) => job === jobKey(key) ? receipt('release-receipt') : undefined };
    // The stored handoff receipt supplies the releaseId when the builder status carries none, but a
    // still-pending binding leaves the job pending too: the host publish transaction owns that
    // transition, and the next run reconverges instead of terminalizing over a lost binding write.
    const first = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const publishedBindings = await buildPendingBindings();
    const out = await reconcilePendingBuild({ jobs: first.store,
      status: reconcileStatusClient({ [JOB]: { jobId: JOB, state: 'published' } }).client,
      bindings: publishedBindings, receipts }, key);
    expect(out).toMatchObject({ outcome: 'binding-still-pending', job: 'unchanged', binding: 'unchanged' });
    expect(out).not.toHaveProperty('error');
    expect(await first.store.read(key)).toMatchObject({ state: 'building' });
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
      { jobId: 'job-a', outcome: 'store-error', job: 'unchanged', binding: 'unchanged', error: 'read-job' },
      { jobId: 'job-b', outcome: 'job-build-failed', job: 'updated', binding: 'updated' },
    ]);
    expect(report.items[1]).not.toHaveProperty('error');
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
    expect(lost).toMatchObject({ outcome: 'store-error', job: 'unchanged', binding: 'updated', error: 'write-job' });
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
    // A failure without a machine code is still a failure, never an outage code.
    expect(await store.read(key)).toMatchObject({ state: 'build_failed', code: 'build_failed' });
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

  it('treats the builder status as bounded: extra keys ignored, blank codes dropped to the default', async () => {
    expect(parseReconcileBuilderStatus({ jobId: JOB, state: 'build_failed', code: '  ', extra: 1 }, JOB))
      .toEqual({ jobId: JOB, state: 'build_failed', code: '  ' });
    expect(parseReconcileBuilderStatus({ jobId: JOB, state: 'published', releaseId: '' }, JOB)).toBeUndefined();
    // The shape keeps the padding, but the reconcile drops it: a blank code carries no signal.
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const { store } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const padded = await reconcilePendingBuild({ jobs: store,
      status: reconcileStatusClient({ [JOB]: { jobId: JOB, state: 'build_failed', code: '  ', reason: '  ' } }).client,
      bindings: await buildPendingBindings() }, key);
    expect(padded).toMatchObject({ outcome: 'job-build-failed', job: 'updated', binding: 'updated' });
    const row = await store.read(key);
    expect(row).toMatchObject({ state: 'build_failed', code: 'build_failed' });
    expect(row).not.toHaveProperty('reason');
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

  it('fails a builder published closed when the wired ledger holds no receipt', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const { store } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const bindings = await buildPendingBindings();
    const receipts = { find: async () => undefined };
    const out = await reconcilePendingBuild({ jobs: store,
      status: reconcileStatusClient({ [JOB]: { jobId: JOB, state: 'published', releaseId: 'release-builder' } }).client,
      bindings, receipts }, key);
    expect(out).toMatchObject({ outcome: 'no-release', job: 'unchanged', binding: 'unchanged' });
    expect(await store.read(key)).toMatchObject({ state: 'building' });
    expect(await bindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'build_pending', version: 2 });
  });

  it('lets a committed receipt override a stale builder failure', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const receipts = { find: async (job: string) => job === jobKey(key) ? receipt('release-receipt') : undefined };
    // The builder still answers failed while the host already committed the receipt: the receipt is
    // host proof, so the job publishes and the stale status is never terminalized.
    const { store } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const out = await reconcilePendingBuild({ jobs: store,
      status: reconcileStatusClient({ [JOB]: failed }).client,
      bindings: await attachedBindings(), receipts }, key);
    expect(out).toMatchObject({ outcome: 'job-published', job: 'updated', binding: 'unchanged' });
    expect(await store.read(key)).toMatchObject({ state: 'published', releaseId: 'release-receipt' });
  });

  it('re-reads a builder failure before writing: a re-admitted run stays pending', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const { store } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const bindings = await buildPendingBindings();
    let calls = 0;
    const status = { status: async () => (++calls === 1 ? failed : { jobId: JOB, state: 'build_pending' as const }) };
    const out = await reconcilePendingBuild({ jobs: store, status, bindings }, key);
    expect(calls).toBe(2);
    expect(out).toMatchObject({ outcome: 'still-pending', job: 'unchanged', binding: 'unchanged' });
    expect(await store.read(key)).toMatchObject({ state: 'building' });
    expect(await bindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'build_pending', version: 2 });
  });

  it('follows a failure-turned-published confirm without a wired ledger', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const { store } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    let calls = 0;
    const answers = [failed, { jobId: JOB, state: 'published' as const, releaseId: 'release-late' }];
    const status = { status: async () => answers[Math.min(calls++, answers.length - 1)] };
    const out = await reconcilePendingBuild({ jobs: store, status, bindings: await attachedBindings() }, key);
    expect(calls).toBe(2);
    expect(out).toMatchObject({ outcome: 'job-published', job: 'updated', binding: 'unchanged' });
    expect(await store.read(key)).toMatchObject({ state: 'published', releaseId: 'release-late' });
  });

  it('never fails the job when the version race was won by the success path', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const { store } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const bindings = await buildPendingBindings();
    const before = (await bindings.get(SCOPE, ARTIFACT))!;
    const write = bindings.write.bind(bindings);
    let raced = false;
    bindings.write = (async (input: Parameters<typeof write>[0]) => {
      if (!raced) {
        raced = true;
        await write({ binding: { ...before, state: 'attached' as const, version: before.version + 1,
          pendingJobId: null, pendingCommitSha: null, updatedAt: before.updatedAt },
          expectedVersion: before.version, actorId: 'alice', idempotencyKey: 'racer-publish',
          commandHash: 'racer-publish', event: { action: 'publish', invocationId: 'race' } });
      }
      return write(input);
    }) as typeof write;
    const out = await reconcilePendingBuild({ jobs: store,
      status: reconcileStatusClient({ [JOB]: failed }).client, bindings }, key);
    expect(out).toMatchObject({ outcome: 'binding-conflict', job: 'unchanged', binding: 'unchanged' });
    expect(await store.read(key)).toMatchObject({ state: 'building' });
    expect(await bindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'attached', version: 3 });
  });

  it('writes anew when the same jobId is re-pended and fails again', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const { store, rows } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const bindings = await buildPendingBindings();
    const options = { jobs: store, status: reconcileStatusClient({ [JOB]: failed }).client, bindings };
    const first = await reconcilePendingBuild(options, key);
    expect(first).toMatchObject({ outcome: 'job-build-failed', job: 'updated', binding: 'updated' });
    expect(await bindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'build_failed', version: 3 });
    // The builder re-admits the same jobId and the host re-pends the binding for it: the second
    // failure must write (version 5), never replay the older failure as `updated`.
    const failedBinding = (await bindings.get(SCOPE, ARTIFACT))!;
    await bindings.write({ binding: { ...failedBinding, state: 'build_pending', version: failedBinding.version + 1,
      updatedAt: failedBinding.updatedAt },
      expectedVersion: failedBinding.version, actorId: 'alice', idempotencyKey: 'repend-1', commandHash: 'repend-1',
      event: { action: 'inbound', invocationId: 'repend' } });
    rows.set(id, { state: 'building', updatedAtMs: 0 });
    const second = await reconcilePendingBuild(options, key);
    expect(second).toMatchObject({ outcome: 'job-build-failed', job: 'updated', binding: 'updated' });
    expect(await bindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'build_failed', version: 5,
      stateDetail: 'build_failed' });
    expect((await bindings.events(SCOPE, ARTIFACT)).map(event => event.action))
      .toEqual(['attach', 'publish', 'publish', 'inbound', 'publish']);
  });

  it('refuses a receipt that disagrees with the binding on the commit SHA', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const { store } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const receipts = { find: async (job: string) =>
      job === jobKey(key) ? receipt('release-receipt', 'd'.repeat(40)) : undefined };
    const out = await reconcilePendingBuild({ jobs: store,
      status: reconcileStatusClient({ [JOB]: { jobId: JOB, state: 'published' } }).client,
      bindings: await buildPendingBindings(), receipts }, key);
    expect(out).toMatchObject({ outcome: 'receipt-conflict', job: 'unchanged', binding: 'unchanged' });
    expect(await store.read(key)).toMatchObject({ state: 'building' });
  });

  it('closes the job when the host keeps no code or reason columns', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    const rows = new Map([[id, { state: 'building', updatedAtMs: 0 }]]);
    const columnless: ReconcileJobStore = {
      async listPending() { return []; },
      async read(input) {
        const row = rows.get(JSON.stringify([input.scopeId, input.artifactId, input.jobId]));
        return row ? { state: row.state } : undefined;
      },
      // No code/reason columns: the hints are ignored, the port stays optional.
      async markFailed(input) {
        const rowKey = JSON.stringify([input.scopeId, input.artifactId, input.jobId]);
        const row = rows.get(rowKey);
        if (!row) return 'not-found';
        if (row.state !== 'build_pending' && row.state !== 'building') return 'already-terminal';
        rows.set(rowKey, { state: 'build_failed', updatedAtMs: 0 });
        return 'updated';
      },
      async markPublished() { return 'already-terminal'; },
    };
    const bindings = await buildPendingBindings();
    const out = await reconcilePendingBuild({ jobs: columnless,
      status: reconcileStatusClient({ [JOB]: failed }).client, bindings }, key);
    expect(out).toMatchObject({ outcome: 'job-build-failed', job: 'updated', binding: 'updated' });
    // The package store still carries the failure code on the binding stateDetail.
    expect(await bindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: 'build_failed', stateDetail: 'build_failed' });
  });

  it('stages store errors: a late read failure reports the stage, a fresh listing stays pending', async () => {
    const id = JSON.stringify([SCOPE, ARTIFACT, JOB]);
    // A binding read that throws after the job and status reads reports its stage truthfully.
    const { store } = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const throwing = await attachedBindings();
    const get = throwing.get.bind(throwing);
    throwing.get = (async () => { throw new Error('binding store down'); }) as typeof get;
    const late = await reconcilePendingBuild({ jobs: store,
      status: reconcileStatusClient({ [JOB]: { jobId: JOB, state: 'published', releaseId: 'release-x' } }).client,
      bindings: throwing }, key);
    expect(late).toMatchObject({ outcome: 'store-error', job: 'unchanged', binding: 'unchanged', error: 'read-binding' });
    expect(await store.read(key)).toMatchObject({ state: 'building' });
    // A host that lists a fresh job anyway does not cost a builder call: the sweep owns the threshold.
    const fresh = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 600_000 } });
    const lyingFresh = { ...fresh.store,
      listPending: async () => [{ scopeId: SCOPE, artifactId: ARTIFACT, jobId: JOB, updatedAtMs: 600_000 }] };
    const calls = vi.fn(async () => ({ jobId: JOB, state: 'build_failed' as const, code: 'x' }));
    const skipped = await reconcilePendingBuilds({ jobs: lyingFresh, status: { status: calls },
      bindings: await buildPendingBindings(), now: () => 600_000, olderThanMs: 300_000 });
    expect(skipped.items).toMatchObject([{ jobId: JOB, outcome: 'still-pending', job: 'unchanged' }]);
    expect(calls).not.toHaveBeenCalled();
    // A host that lists a malformed row gets a per-item defect, never an aborted sweep.
    const malformed = reconcileJobStore({ [id]: { state: 'building', updatedAtMs: 0 } });
    const lying = { ...malformed.store,
      listPending: async () => [{ scopeId: 'no good', artifactId: ARTIFACT, jobId: JOB, updatedAtMs: 0 }] };
    const uncalled = vi.fn(async () => ({ jobId: JOB, state: 'build_failed' as const, code: 'x' }));
    const defective = await reconcilePendingBuilds({ jobs: lying, status: { status: uncalled },
      bindings: await buildPendingBindings(), now: () => 3_600_000 });
    expect(defective.items).toMatchObject(
      [{ outcome: 'store-error', job: 'unchanged', binding: 'unchanged', error: 'list-pending' }]);
    expect(uncalled).not.toHaveBeenCalled();
  });
});
