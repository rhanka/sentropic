/**
 * L-5a — operation idempotency: one result per key, explicit conflicts.
 *
 * Repeating a request with the same idempotency key and the same parameter
 * hash returns the stored result without re-executing (replayed=true).
 * Reusing a key with different parameters is an explicit conflict, never a
 * silent overwrite. Different keys are independent. Retry keys live outside
 * manifests and never corrupt semantic deduplication.
 */
import { describe, expect, it } from 'vitest';
import { createIdempotencyStore, createMemoryIdempotencyKv } from '../src/server/idempotency.js';

describe('operation idempotency', () => {
  it('executes once and replays the stored result', async () => {
    const store = createIdempotencyStore(createMemoryIdempotencyKv());
    let calls = 0;
    const work = async () => {
      calls += 1;
      return { artifactId: 'new-uuid' };
    };
    const first = await store.execute('key-1', 'hash-a', work);
    const second = await store.execute('key-1', 'hash-a', work);
    const third = await store.execute('key-1', 'hash-a', work);
    expect(calls).toBe(1);
    expect(first).toEqual({ result: { artifactId: 'new-uuid' }, replayed: false });
    expect(second).toEqual({ result: { artifactId: 'new-uuid' }, replayed: true });
    expect(third.replayed).toBe(true);
  });

  it('refuses key reuse with different parameters', async () => {
    const store = createIdempotencyStore(createMemoryIdempotencyKv());
    await store.execute('key-1', 'hash-a', async () => ({ ok: true }));
    await expect(store.execute('key-1', 'hash-b', async () => ({ ok: true }))).rejects.toThrow(
      /idempotency conflict/,
    );
  });

  it('keeps different keys independent', async () => {
    const store = createIdempotencyStore(createMemoryIdempotencyKv());
    let calls = 0;
    const work = async () => {
      calls += 1;
      return calls;
    };
    await store.execute('key-1', 'hash-a', work);
    const other = await store.execute('key-2', 'hash-a', work);
    expect(calls).toBe(2);
    expect(other).toEqual({ result: 2, replayed: false });
  });
});
