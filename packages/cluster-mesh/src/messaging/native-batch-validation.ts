import { canonicalJson } from './canonical-json.js';
import type {
  NativeDrainCursor,
  NativeDrainFence,
  NativeMessageBatch,
} from './native-drain-contracts.js';
import {
  laterPosition,
  sameCursor,
  validAddress,
  validCursor,
  validIntent,
  validPayload,
  validTimestamp,
} from './validation.js';

export const validateNativeBatch = (input: {
  readonly fence: NativeDrainFence;
  readonly expectedCursor: NativeDrainCursor | null;
  readonly batch: NativeMessageBatch;
}): boolean => {
  const { fence, expectedCursor, batch } = input;
  if (!fence.sourceId || !fence.workerId || !fence.leaseId
    || !Number.isSafeInteger(fence.generation) || fence.generation <= 0
    || !validTimestamp(fence.acquiredAt) || !validTimestamp(fence.expiresAt)
    || (expectedCursor !== null && !validCursor(expectedCursor))
    || !batch || batch.sourceId !== fence.sourceId || !batch.sourceEpoch
    || !Array.isArray(batch.records) || typeof batch.exhausted !== 'boolean'
    || !sameCursor(batch.after, expectedCursor)) return false;
  if (expectedCursor && (expectedCursor.sourceId !== batch.sourceId
    || expectedCursor.sourceEpoch !== batch.sourceEpoch)) return false;

  const nativeIds = new Set<string>();
  let previousPosition = expectedCursor?.position ?? null;
  let lastCursor: NativeDrainCursor | null = expectedCursor;
  for (const record of batch.records) {
    if (!record || !record.nativeMessageId || nativeIds.has(record.nativeMessageId)
      || !validCursor(record.cursorAfter)
      || record.cursorAfter.sourceId !== batch.sourceId
      || record.cursorAfter.sourceEpoch !== batch.sourceEpoch
      || !laterPosition(previousPosition, record.cursorAfter.position)
      || !validAddress(record.destination) || !validPayload(record.payload)
      || (record.actuation !== undefined && !validIntent(record.actuation))
      || (record.producedAt !== undefined && !validTimestamp(record.producedAt))
      || (record.expiresAt !== undefined && !validTimestamp(record.expiresAt))) return false;
    try {
      if (record.metadata !== undefined) canonicalJson(record.metadata);
    } catch { return false; }
    nativeIds.add(record.nativeMessageId);
    previousPosition = record.cursorAfter.position;
    lastCursor = record.cursorAfter;
  }
  return batch.records.length === 0
    ? sameCursor(batch.nextCursor, expectedCursor)
    : batch.nextCursor !== null && sameCursor(batch.nextCursor, lastCursor);
};
