import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import type { ExecutionNodeAdapter } from '../../src/services/artifacts/live/execution-node-adapter';
import { executionNodeHeartbeat } from '../../src/services/artifacts/live/execution-node-heartbeat';

describe('bounded cross-replica heartbeat leadership', () => {
  afterEach(() => vi.useRealTimers());
  it('should destroy a stalled DB leader and allow a second replica to acquire the lock', async () => {
    vi.useFakeTimers(); let held = false; let stall = false;
    const clients: Array<EventEmitter & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }> = [];
    const pool = { connect: async () => {
      const client = new EventEmitter(); let owns = false;
      const entry = Object.assign(client, {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('try_advisory_lock')) {
            const acquired = !held; if (acquired) { held = true; owns = true; }
            return { rows: [{ held: acquired }] };
          }
          if (clients[0] === entry && stall) return new Promise<never>(() => {});
          return { rows: [] };
        }),
        release: vi.fn(() => { if (owns) held = false; owns = false; }),
      }); clients.push(entry); return entry;
    } } as unknown as Pool;
    const node = () => ({ config: { nodeId: 'node' }, inspect: vi.fn(async () => {}), heartbeat: vi.fn(async () => {}) });
    const a = node(), b = node();
    const first = executionNodeHeartbeat(pool, a as unknown as ExecutionNodeAdapter, vi.fn());
    const second = executionNodeHeartbeat(pool, b as unknown as ExecutionNodeAdapter, vi.fn());
    first.start(); await vi.advanceTimersByTimeAsync(0); second.start(); await vi.advanceTimersByTimeAsync(0);
    expect(a.heartbeat).toHaveBeenCalledOnce(); expect(b.heartbeat).not.toHaveBeenCalled();
    stall = true; await vi.advanceTimersByTimeAsync(1300);
    expect(clients[0]!.release).toHaveBeenCalledWith(true);
    // Emulate the failed replica remaining disconnected; the healthy follower takes the next lock.
    await first.stop(); await vi.advanceTimersByTimeAsync(1000);
    expect(b.heartbeat).toHaveBeenCalled(); await second.stop(); expect(held).toBe(false);
  });
  it('should bound saturated pool acquisition and destroy a late connection without acquiring a lock', async () => {
    vi.useFakeTimers(); let deliver!: (client: unknown) => void;
    const client = { query: vi.fn(), release: vi.fn() };
    const pool = { connect: () => new Promise(resolve => { deliver = resolve; }) } as unknown as Pool;
    const node = { config: { nodeId: 'node' }, inspect: vi.fn(), heartbeat: vi.fn() };
    const alarm = vi.fn(); const leader = executionNodeHeartbeat(pool, node as unknown as ExecutionNodeAdapter, alarm);
    leader.start(); await vi.advanceTimersByTimeAsync(301); await leader.stop();
    deliver(client); await vi.advanceTimersByTimeAsync(0);
    expect(alarm).toHaveBeenCalledOnce(); expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(client.query).not.toHaveBeenCalled(); expect(node.heartbeat).not.toHaveBeenCalled();
  });
  it('should cancel an already dispatched heartbeat when the DB session is lost', async () => {
    vi.useFakeTimers(); const client = Object.assign(new EventEmitter(), {
      query: vi.fn(async () => ({ rows: [{ held: true }] })), release: vi.fn(),
    });
    let signal: AbortSignal | undefined;
    const node = { config: { nodeId: 'node' }, inspect: async () => {}, heartbeat: vi.fn(async (sent: AbortSignal) => {
      signal = sent; await new Promise<void>(resolve => sent.addEventListener('abort', () => resolve(), { once: true }));
    }) };
    const leader = executionNodeHeartbeat({ connect: async () => client } as unknown as Pool, node as unknown as ExecutionNodeAdapter, vi.fn());
    leader.start(); await vi.advanceTimersByTimeAsync(0); expect(signal?.aborted).toBe(false);
    client.emit('error', new Error('connection_lost')); await leader.stop();
    expect(signal?.aborted).toBe(true); expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
});
