import { sameFence } from './drain-fence-operation.js';
import type { PreparedPut } from './local-model.js';
import { LocalMessagingState } from './local-state.js';
import type {
  NativeDrainCursor,
  NativeDrainFence,
  NativeDrainImportResult,
  NativeMessageBatch,
} from './native-drain-contracts.js';
import { sameCursor } from './validation.js';

export const mutateNativeImport = (input: {
  readonly state: LocalMessagingState;
  readonly fence: NativeDrainFence;
  readonly expectedCursor: NativeDrainCursor | null;
  readonly batch: NativeMessageBatch;
  readonly prepared: readonly PreparedPut[];
}): NativeDrainImportResult => {
  const { state, fence, expectedCursor, batch, prepared } = input;
  const nowMs = state.nowMs();
  const drain = state.drains.get(fence.sourceId);
  if (!drain?.fence || !sameFence(drain.fence, fence)) return { ok: false, reason: 'fenced' };
  if (nowMs === null) return { ok: false, reason: 'unavailable' };
  if (Date.parse(drain.fence.expiresAt) <= nowMs) return { ok: false, reason: 'lease_expired' };
  if (!sameCursor(drain.cursor, expectedCursor)) return { ok: false, reason: 'cursor_conflict' };
  if (drain.sourceEpoch && drain.sourceEpoch !== batch.sourceEpoch) {
    return { ok: false, reason: 'source_epoch_changed' };
  }
  state.cleanup(nowMs);
  const preflight = preflightBatch(state, prepared);
  if (preflight !== null) return { ok: false, reason: preflight };
  let imported = 0;
  for (const item of prepared) {
    const result = state.mutatePut(item);
    if ('error' in result) return { ok: false, reason: 'unavailable' };
    if (result.outcome === 'accepted') imported += 1;
  }
  drain.sourceEpoch = batch.sourceEpoch;
  drain.cursor = batch.nextCursor;
  return {
    ok: true,
    outcome: batch.exhausted ? 'exhausted' : imported === 0 ? 'idempotent_replay' : 'advanced',
    imported,
    cursor: drain.cursor,
  };
};

type PreflightFailure = 'invalid_batch' | 'capacity_exhausted' | 'unavailable';

const preflightBatch = (
  state: LocalMessagingState,
  prepared: readonly PreparedPut[],
): PreflightFailure | null => {
  let addedMessages = 0;
  let addedBytes = 0;
  const scopes = new Set<string>();
  const messageIds = new Set<string>();
  const deliveryIds = new Set<string>();
  const mailboxAdds = new Map<string, number>();
  for (const item of prepared) {
    if (scopes.has(item.idempotencyScope)) return 'invalid_batch';
    scopes.add(item.idempotencyScope);
    const existingId = state.idempotency.get(item.idempotencyScope);
    if (existingId) {
      const existing = state.messages.get(existingId);
      if (!existing) return 'unavailable';
      if (existing.fingerprint !== item.fingerprint) return 'invalid_batch';
      continue;
    }
    if (state.messages.has(item.message.messageId) || messageIds.has(item.message.messageId)) {
      return 'unavailable';
    }
    messageIds.add(item.message.messageId);
    addedMessages += 1;
    addedBytes += item.messageBytes + item.deliveryBytes;
    for (const deliveryId of item.deliveryIds) {
      if (state.deliveries.has(deliveryId) || deliveryIds.has(deliveryId)) return 'unavailable';
      deliveryIds.add(deliveryId);
    }
    for (const mailboxId of item.mailboxIds) {
      mailboxAdds.set(mailboxId, (mailboxAdds.get(mailboxId) ?? 0) + 1);
    }
  }
  if (state.messages.size + addedMessages > state.options.maxMessages
    || state.totalBytes + addedBytes > state.options.maxBytes) return 'capacity_exhausted';
  for (const [mailboxId, added] of mailboxAdds) {
    const next = state.mailboxes.get(mailboxId)?.nextSequence ?? 1;
    if (!Number.isSafeInteger(next + added)) return 'unavailable';
  }
  return null;
};
