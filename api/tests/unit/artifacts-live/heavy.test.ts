import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createHeavyGate, createPostgresHeavyGate, gated } from '../../../src/services/artifacts/live/heavy';

const k = { storageScopeId: 's', artifactId: 'a' };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe('live heavy-phase gate (one heavy phase per node)', () => {
  it('should run heavy phases one at a time in arrival order', async () => {
    const gate = createHeavyGate({ maxWaitMs: 1000 }); const order: string[] = []; const first = deferred();
    const a = gate.run(k, 'revive', async () => { order.push('a:start'); await first.promise; order.push('a:end'); });
    const b = gate.run(k, 'idle_build', async () => { order.push('b'); });
    const c = gate.run(k, 'crash_restore', async () => { order.push('c'); });
    await new Promise(resolve => setImmediate(resolve)); expect(order).toEqual(['a:start']);
    first.resolve(); await Promise.all([a, b, c]); expect(order).toEqual(['a:start', 'a:end', 'b', 'c']);
  });
  it('should refuse a waiter past the bound with builder_unavailable/queued and never run it', async () => {
    const gate = createHeavyGate({ maxWaitMs: 5 }); const held = deferred(); const late = vi.fn(async () => undefined);
    const holder = gate.run(k, 'revive', () => held.promise);
    await expect(gate.run(k, 'explicit_build', late)).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'queued' });
    held.resolve(); await holder; expect(late).not.toHaveBeenCalled();
    await expect(gate.run(k, 'wake', async () => 'next')).resolves.toBe('next');
  });
  it('should free the slot when the heavy phase throws', async () => {
    const gate = createHeavyGate({ maxWaitMs: 1000 });
    await expect(gate.run(k, 'revive', async () => { throw new Error('oom'); })).rejects.toThrow('oom');
    await expect(gate.run(k, 'revive', async () => 1)).resolves.toBe(1);
  });
  it('should run the refusal teardown only when the gate refused before the phase started', async () => {
    const gate = createHeavyGate({ maxWaitMs: 5 }); const refused = vi.fn(async () => undefined);
    await expect(gated(gate, k, 'wake', refused, async () => { throw new Error('inside'); })).rejects.toThrow('inside');
    expect(refused).not.toHaveBeenCalled();
    const held = deferred(); const holder = gate.run(k, 'revive', () => held.promise);
    await expect(gated(gate, k, 'wake', refused, async () => 1)).rejects.toMatchObject({ reason: 'queued' });
    expect(refused).toHaveBeenCalledOnce(); held.resolve(); await holder;
  });
  it('should hold a node advisory lock on a discarded connection and map lock_timeout to queued', async () => {
    const queries: string[] = []; const release = vi.fn();
    let refuse = false;
    const client = { release, query: vi.fn(async (sql: string, params: unknown[]) => {
      queries.push(`${sql} ${JSON.stringify(params)}`);
      if (refuse && sql.includes('pg_advisory_lock')) throw Object.assign(new Error('lock timeout'), { code: '55P03' });
      return { rows: [] };
    }) };
    const gate = createPostgresHeavyGate({ connect: async () => client } as unknown as Pool, { node: 'artifact-builders', maxWaitMs: 900000 });
    await expect(gate.run(k, 'revive', async () => 'done')).resolves.toBe('done');
    expect(queries[0]).toContain('"900000ms"'); expect(queries[1]).toContain('artifact-live-heavy/v1:artifact-builders');
    expect(release).toHaveBeenLastCalledWith(true);
    refuse = true; const work = vi.fn(async () => 'never');
    await expect(gate.run(k, 'idle_build', work)).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'queued' });
    expect(work).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledTimes(2); expect(release).toHaveBeenLastCalledWith(true);
  });
});
