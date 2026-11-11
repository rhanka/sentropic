import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createHeavyPhaseQueue, createMemoryHeavyPhaseQueueStore, PROVISIONAL_HEAVY_PHASE_COSTS_MIB,
  type HeavyPhaseQueueStore } from '@sentropic/cluster-mesh';
import { createPostgresHeavyQueueStore, createQueuedHeavyGate, gatedInstall } from '../../../src/services/artifacts/live/heavy';
import type { LiveRuntime } from '../../../src/services/artifacts/live/records';
import type { InstallStepFields } from '../../../src/services/artifacts/live/deadline';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const budget = { budgetMiB: 1641, podBaseMiB: 19, costs: PROVISIONAL_HEAVY_PHASE_COSTS_MIB, entryTtlMs: 60_000 };
function world(options: { maxWaitMs?: number; store?: HeavyPhaseQueueStore;
  holds?: () => Promise<{ pods: string[]; lives: string[] }> } = {}) {
  const queue = createHeavyPhaseQueue({ store: options.store ?? createMemoryHeavyPhaseQueueStore(), now: () => 0, budget,
    maxPods: 4 });
  const gate = createQueuedHeavyGate({ queue, node: 'n', maxWaitMs: options.maxWaitMs ?? 1000, pollMs: 1, renewMs: 5,
    holds: options.holds ?? (async () => ({ pods: [], lives: [] })) });
  return { queue, gate };
}

describe('live heavy gate (client of the cluster-mesh heavy-phase queue)', () => {
  it('should run two pre-bundles one after the other on one node', async () => {
    const { gate } = world(); const order: string[] = []; const first = deferred();
    const a = gate.run('v1', 'prebundle', async () => { order.push('a:start'); await first.promise; order.push('a:end'); });
    const b = gate.run('v2', 'prebundle', async () => { order.push('b'); });
    await new Promise(resolve => setTimeout(resolve, 10)); expect(order).toEqual(['a:start']);
    first.resolve(); await Promise.all([a, b]); expect(order).toEqual(['a:start', 'a:end', 'b']);
  });
  it('should turn a finished dev into the live reservation, never a failed one, and release it with the hold', async () => {
    const { gate, queue } = world();
    await expect(gate.run('v1', 'dev', async () => 'ready', { live: true })).resolves.toBe('ready');
    await expect(gate.run('v2', 'dev', async () => { throw new Error('oom'); }, { live: true })).rejects.toThrow('oom');
    expect(await queue.status('n')).toMatchObject({ lives: ['v1'], entries: [] });
    await gate.hold('v1', { live: false }); expect((await queue.status('n')).lives).toEqual([]);
  });
  it('should refuse past the wait bound with builder_unavailable/queued, leave the queue and never run the work', async () => {
    const { gate, queue } = world({ maxWaitMs: 5 }); const held = deferred(); const late = vi.fn(async () => undefined);
    const holder = gate.run('v1', 'build', () => held.promise);
    await expect(gate.run('v2', 'build', late)).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'queued' });
    expect((await queue.status('n')).entries.map(e => e.subject)).toEqual(['v1']);
    held.resolve(); await holder; expect(late).not.toHaveBeenCalled();
  });
  it('should abort a queued wait on the watchdog signal and leave the queue without running', async () => {
    const { gate, queue } = world(); const held = deferred(); const late = vi.fn(async () => 'never');
    const holder = gate.run('v1', 'build', () => held.promise);
    const controller = new AbortController();
    const waiting = gate.run('v2', 'build', late, { signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    await expect(waiting).rejects.toThrow();
    expect(late).not.toHaveBeenCalled();
    expect((await queue.status('n')).entries.map(e => e.subject)).toEqual(['v1']);
    held.resolve(); await holder;
  });
  it('should keep a durable waiter at its position and expose it as queued', async () => {
    const { gate } = world(); const held = deferred();
    const holder = gate.run('v1', 'build', () => held.promise);
    await expect(gate.run('v2', 'build', async () => 'early', { waitMs: 0, keep: true })).rejects.toMatchObject({ reason: 'queued' });
    expect(await gate.status('v2')).toEqual([{ kind: 'build', state: 'queued', position: 1 }]);
    held.resolve(); await holder;
    await expect(gate.run('v2', 'build', async () => 'built', { waitMs: 0, keep: true })).resolves.toBe('built');
    expect(await gate.status('v2')).toEqual([]);
  });
  it('should seed pod and live holds from the durable runtimes before its first decision', async () => {
    const holds = vi.fn(async () => ({ pods: ['v1', 'v2'], lives: ['v1'] })); const { gate, queue } = world({ holds });
    await expect(gate.run('v2', 'build', async () => 'built', { waitMs: 0 })).rejects.toMatchObject({ reason: 'queued' });
    await gate.cancel('v2');
    expect(holds).toHaveBeenCalledOnce();
    expect(await queue.status('n')).toMatchObject({ pods: ['v1', 'v2'], lives: ['v1'], entries: [] });
  });
  it('should gate an in-pod clean install as the install phase only', async () => {
    const { gate } = world({ maxWaitMs: 5 }); const held = deferred();
    const install = vi.fn(async () => ({ runId: 'run' })); const wrapped = gatedInstall(gate, install);
    const input = { lockfile: new Uint8Array(), identity: {} as never, recipe: {} as never, stagingRef: 's',
      tarballs: (async function* () {})(), sink: async () => undefined };
    const holder = gate.run('v1', 'build', () => held.promise);
    await expect(wrapped({ ...input, runtime: { podName: 'v2' } as LiveRuntime })).rejects.toMatchObject({ reason: 'queued' });
    expect(install).not.toHaveBeenCalled();
    await expect(wrapped(input)).resolves.toMatchObject({ runId: 'run' });
    held.resolve(); await holder;
    await expect(wrapped({ ...input, runtime: { podName: 'v2' } as LiveRuntime })).resolves.toMatchObject({ runId: 'run' });
  });
  it('should log heavy_admit ok at admission time, before the install completes', async () => {
    const { gate } = world();
    const lines: InstallStepFields[] = [];
    let now = 1_000;
    let loggedBeforeInstall = false;
    const install = vi.fn(async () => {
      loggedBeforeInstall = lines.some(line => line.step === 'heavy_admit' && line.outcome === 'ok');
      await new Promise(resolve => setTimeout(resolve, 20));
      return { runId: 'run' };
    });
    const wrapped = gatedInstall(gate, install, { log: fields => lines.push(fields), now: () => (now += 15) });
    const input = { lockfile: new Uint8Array(), identity: {} as never, recipe: {} as never, stagingRef: 's',
      tarballs: (async function* () {})(), sink: async () => undefined,
      progress: { report: () => undefined, suspendStall: () => undefined,
        step: vi.fn(), clearStep: vi.fn() } };
    await expect(wrapped({ ...input, runtime: { podName: 'v2' } as LiveRuntime }))
      .resolves.toMatchObject({ runId: 'run' });
    expect(loggedBeforeInstall).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'artifact_live_install_step', step: 'heavy_admit', outcome: 'ok' });
    expect(lines[0].ms).toBeLessThan(20);
    expect(input.progress.step).toHaveBeenCalledWith('heavy_admit');
    expect(input.progress.clearStep).toHaveBeenCalledOnce();
  });
  it('should log heavy_admit fail once on queued admission without running the install', async () => {
    const { gate } = world({ maxWaitMs: 5 }); const held = deferred();
    const lines: InstallStepFields[] = [];
    const install = vi.fn(async () => ({ runId: 'run' }));
    const wrapped = gatedInstall(gate, install, { log: fields => lines.push(fields), now: () => 0 });
    const input = { lockfile: new Uint8Array(), identity: {} as never, recipe: {} as never, stagingRef: 's',
      tarballs: (async function* () {})(), sink: async () => undefined };
    const holder = gate.run('v1', 'build', () => held.promise);
    await expect(wrapped({ ...input, runtime: { podName: 'v2' } as LiveRuntime }))
      .rejects.toMatchObject({ code: 'builder_unavailable', reason: 'queued' });
    expect(install).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'artifact_live_install_step', step: 'heavy_admit', outcome: 'fail',
      reason: 'builder_unavailable:queued' });
    held.resolve(); await holder;
  });
  it('should not double-log heavy_admit fail when the admitted install itself fails', async () => {
    const { gate } = world();
    const lines: InstallStepFields[] = [];
    const failure = new Error('install boom');
    const install = vi.fn(async () => { throw failure; });
    const wrapped = gatedInstall(gate, install, { log: fields => lines.push(fields), now: () => 0 });
    const input = { lockfile: new Uint8Array(), identity: {} as never, recipe: {} as never, stagingRef: 's',
      tarballs: (async function* () {})(), sink: async () => undefined };
    await expect(wrapped({ ...input, runtime: { podName: 'v2' } as LiveRuntime })).rejects.toBe(failure);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ step: 'heavy_admit', outcome: 'ok' });
  });
  it('should keep the queue durable in the host KV with a node row lock and roll back a failed transaction', async () => {
    const queries: string[] = []; let stored: string | undefined; const release = vi.fn();
    const client = { release, query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push(`${sql.trim().split(/\s+/).slice(0, 2).join(' ')} ${JSON.stringify(params.slice(0, 2))}`);
      if (sql.startsWith('SELECT value')) return { rows: stored ? [{ value: stored }] : [] };
      if (sql.startsWith('INSERT')) stored = params[2] as string;
      return { rows: [] };
    }) };
    const store = createPostgresHeavyQueueStore({ connect: async () => client } as unknown as Pool);
    await world({ store }).gate.run('v1', 'build', async () => {
      expect((await world({ store }).queue.status('n')).entries).toMatchObject([{ subject: 'v1', state: 'admitted' }]);
    });
    expect(queries.slice(0, 5)).toEqual(['BEGIN []', 'SELECT pg_advisory_xact_lock(hashtextextended($1, ["artifact-live-heavy-queue/v1:n"]',
      'SELECT value ["artifact-live-heavy-queue/v1","n"]', 'INSERT INTO ["artifact-live-heavy-queue/v1","n"]', 'COMMIT []']);
    await expect(store.transaction('n', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(queries.at(-1)).toBe('ROLLBACK []'); expect(release).toHaveBeenCalledTimes(queries.filter(q => q === 'BEGIN []').length);
  });
});
