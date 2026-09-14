import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  NativeDrainCursor, NativeDrainFence, NativeMessageBatch, NativeMessageRecord,
} from '../src/index.js';
import {
  allow, denyAction, messagingFixture, productContext, putRequest,
} from './messaging-fixture.js';

type Store = ReturnType<typeof messagingFixture>['store'];
const cursor = (position: string, sourceEpoch = 'epoch-1'): NativeDrainCursor => ({
  sourceId: 'source-1', sourceEpoch, position,
});
const record = (
  nativeMessageId: string, position: string, sourceEpoch = 'epoch-1',
): NativeMessageRecord => ({
  nativeMessageId, cursorAfter: cursor(position, sourceEpoch),
  destination: { kind: 'mailbox', mailboxId: 'mailbox-1' },
  payload: { contentType: 'application/json', value: { nativeMessageId } },
});
const batch = (
  records: readonly NativeMessageRecord[], after: NativeDrainCursor | null = null,
  sourceEpoch = 'epoch-1',
): NativeMessageBatch => ({
  sourceId: 'source-1', sourceEpoch, after, records,
  nextCursor: records.at(-1)?.cursorAfter ?? after, exhausted: false,
});
const acquire = async (
  store: Store, workerId = 'worker-1', leaseMs = 100,
): Promise<NativeDrainFence> => {
  const result = await store.acquire({ sourceId: 'source-1', workerId, leaseMs });
  if (!result.ok) throw new Error('Expected drain fence');
  return result.fence;
};

describe('bounded-local native drain', () => {
  it('increments takeover generation and fences a stale valid-looking lease and cursor CAS', async () => {
    const fixture = messagingFixture();
    const stale = await acquire(fixture.store);
    fixture.advance(101);
    await expect(fixture.store.importBatch({
      context: productContext, fence: stale, expectedCursor: null,
      batch: batch([record('native-1', '1')]),
    })).resolves.toEqual({ ok: false, reason: 'lease_expired' });
    const current = await acquire(fixture.store, 'worker-2');
    expect(current.generation).toBe(stale.generation + 1);
    const firstBatch = batch([record('native-1', '1')]);

    await expect(fixture.store.importBatch({
      context: productContext,
      fence: { ...stale, expiresAt: '2031-01-01T00:00:00.000Z' },
      expectedCursor: null, batch: firstBatch,
    })).resolves.toEqual({ ok: false, reason: 'fenced' });
    await expect(fixture.store.importBatch({
      context: productContext, fence: current, expectedCursor: null, batch: firstBatch,
    })).resolves.toMatchObject({ ok: true, outcome: 'advanced', cursor: cursor('1') });
    await expect(fixture.store.importBatch({
      context: productContext, fence: current, expectedCursor: null, batch: firstBatch,
    })).resolves.toEqual({ ok: false, reason: 'cursor_conflict' });
  });

  it('replays a pre-advance put idempotently with the native/v1 key and never mutates its source', async () => {
    const fixture = messagingFixture();
    const native = record('native-1', '1');
    const expectedKey = `native/v1:${createHash('sha256').update(
      '{"nativeMessageId":"native-1","sourceEpoch":"epoch-1","sourceId":"source-1"}',
    ).digest('base64url')}`;
    await expect(fixture.store.put(putRequest(expectedKey, {
      destination: native.destination, payload: native.payload,
    }))).resolves.toMatchObject({ ok: true, outcome: 'accepted', messageId: 'message-1' });
    const sourceBatch = Object.freeze(batch([native]));
    const snapshot = structuredClone(sourceBatch);
    const source = { read: vi.fn(async () => sourceBatch) };
    const observed = await source.read({ sourceId: 'source-1', after: null, limit: 10 });
    const fence = await acquire(fixture.store);

    await expect(fixture.store.importBatch({
      context: productContext, fence, expectedCursor: null, batch: observed,
    })).resolves.toEqual({
      ok: true, outcome: 'idempotent_replay', imported: 0, cursor: cursor('1'),
    });
    expect(source.read).toHaveBeenCalledWith({ sourceId: 'source-1', after: null, limit: 10 });
    expect(Object.keys(source)).toEqual(['read']);
    expect(sourceBatch).toEqual(snapshot);
    const popped = await fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' });
    expect(popped).toMatchObject({
      ok: true, outcome: 'delivery',
      delivery: { message: { messageId: 'message-1', idempotencyKey: expectedKey } },
    });
  });

  it('keeps the cursor on epoch change, cursor regression, and malformed batches', async () => {
    const fixture = messagingFixture();
    const fence = await acquire(fixture.store);
    await fixture.store.importBatch({
      context: productContext, fence, expectedCursor: null,
      batch: batch([record('native-1', '1')]),
    });
    const current = cursor('1');
    await expect(fixture.store.importBatch({
      context: productContext, fence, expectedCursor: current,
      batch: batch([record('native-2', '2', 'epoch-2')], current, 'epoch-2'),
    })).resolves.toEqual({ ok: false, reason: 'source_epoch_changed' });
    await expect(fixture.store.importBatch({
      context: productContext, fence, expectedCursor: current,
      batch: batch([record('native-2', '1')], current),
    })).resolves.toEqual({ ok: false, reason: 'invalid_batch' });
    await expect(fixture.store.importBatch({
      context: productContext, fence, expectedCursor: current,
      batch: batch([record('duplicate', '2'), record('duplicate', '3')], current),
    })).resolves.toEqual({ ok: false, reason: 'invalid_batch' });
    fixture.setAuthorization(denyAction('message:put'));
    await expect(fixture.store.importBatch({
      context: productContext, fence, expectedCursor: current,
      batch: batch([record('native-2', '2')], current),
    })).resolves.toEqual({ ok: false, reason: 'forbidden' });
    fixture.setAuthorization(async ({ context }) => allow(context.policyRevision));
    await expect(fixture.store.importBatch({
      context: productContext, fence, expectedCursor: current,
      batch: batch([record('native-2', '2')], current),
    })).resolves.toMatchObject({ ok: true, cursor: cursor('2') });
  });

  it('rejects a complete batch at capacity without advancing or evicting work', async () => {
    const fixture = messagingFixture({ options: { maxMessages: 1 } });
    await fixture.store.put(putRequest('retained'));
    const fence = await acquire(fixture.store);
    await expect(fixture.store.importBatch({
      context: productContext, fence, expectedCursor: null,
      batch: batch([record('native-1', '1')]),
    })).resolves.toEqual({ ok: false, reason: 'capacity_exhausted' });
    expect(await fixture.store.release({ fence })).toBe(true);
    const reacquired = await fixture.store.acquire({
      sourceId: 'source-1', workerId: 'worker-2', leaseMs: 100,
    });
    expect(reacquired).toMatchObject({ ok: true, cursor: null });
    await expect(fixture.store.pop({ context: productContext, mailboxId: 'mailbox-1' }))
      .resolves.toMatchObject({ ok: true, delivery: { message: { idempotencyKey: 'retained' } } });
  });
});
