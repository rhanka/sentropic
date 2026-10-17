import { StorageCasConflictError, StorageInvalidCommandError } from './errors.js';
import type { ScopedRuntime } from './scope-runtime.js';
import { opaqueId, ownedCopy, type JournalFence, type StagedCore } from './staged-core.js';
import type { RootConsumer, RootJournalEvent } from './staged-state.js';
import { stagedLimits } from './staged-operations.js';

export const journalConsumer = (core: StagedCore, bound: ScopedRuntime, name: string): RootConsumer => {
  if (typeof name !== 'string' || !name || name.length > 1024) throw new StorageInvalidCommandError('invalid consumer identity');
  const consumers = core.control(bound.scope).consumers;
  let state = consumers.get(name);
  if (!state) {
    state = { cursor: 0, scanned: 0, status: 'running', failedEvent: null, failedReason: null, failedSeq: null,
      retryAuthorized: false, deliveredPoison: false, actions: [] };
    consumers.set(name, state);
  }
  return state;
};
export const validateJournalWindow = (core: StagedCore, after: number, limit: number): void => {
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit <= 0 || limit > stagedLimits(core).maxRecords) {
    throw new StorageInvalidCommandError('journal reader requires a bounded window');
  }
};
export const readRootJournal = (core: StagedCore, bound: ScopedRuntime, after: number, limit: number, consumer?: string) => {
  bound.requireOperation('read'); validateJournalWindow(core, after, limit);
  const data = core.data(core.current(bound.scope));
  if (after > data.journal.length) throw new StorageInvalidCommandError('journal position exceeds watermark');
  const state = consumer === undefined ? undefined : journalConsumer(core, bound, consumer);
  const contiguous = state !== undefined && after <= state.scanned;
  const events: RootJournalEvent[] = [];
  let bytes = 0;
  if (!state || state.status === 'running') {
    for (let index = after; index < Math.min(data.journal.length, after + limit); index += 1) {
      const event = data.journal.at(index)!;
      const size = Buffer.byteLength(JSON.stringify(event), 'utf8');
      if (bytes + size > stagedLimits(core).maxEncodedBytes) break;
      events.push(ownedCopy(event)); bytes += size;
      if (state) {
        if (contiguous) state.scanned = Math.max(state.scanned, event.seq);
        if (state.retryAuthorized && event.eventId === state.failedEvent) state.deliveredPoison = true;
      }
    }
  }
  return { events, watermark: data.journal.length };
};
export const checkpointRootJournal = (core: StagedCore, bound: ScopedRuntime, consumer: string, expected: number, next: number, fence: JournalFence): void => {
  core.assertJournalFence(bound.grant, fence);
  const state = journalConsumer(core, bound, consumer);
  if (state.cursor !== expected) throw new StorageCasConflictError('checkpoint expectation changed');
  if (!Number.isSafeInteger(next) || next < expected || next > core.data(core.current(bound.scope)).journal.length || next > state.scanned || state.status !== 'running') {
    throw new StorageInvalidCommandError('checkpoint exceeds delivered running progress');
  }
  if (state.failedSeq !== null && next >= state.failedSeq && (!state.retryAuthorized || !state.deliveredPoison)) throw new StorageInvalidCommandError('poison requires authorized redelivery');
  state.cursor = next;
  if (state.failedSeq !== null && next >= state.failedSeq) {
    state.failedEvent = null; state.failedReason = null; state.failedSeq = null; state.retryAuthorized = false; state.deliveredPoison = false;
  }
};
export const inspectRootConsumer = (core: StagedCore, bound: ScopedRuntime, consumer: string) => {
  bound.requireOperation('read');
  const state = journalConsumer(core, bound, consumer);
  return { cursor: state.cursor, status: state.status, failedEvent: state.failedEvent, failedReason: state.failedReason,
    lag: core.data(core.current(bound.scope)).journal.length - state.cursor };
};
export const poisonRootConsumer = (core: StagedCore, bound: ScopedRuntime, consumer: string, eventId: string, reason: string): void => {
  core.requireMaintain(bound.grant);
  const state = journalConsumer(core, bound, consumer);
  let identity: unknown;
  try { identity = JSON.parse(eventId); } catch { throw new StorageInvalidCommandError('unknown failed event'); }
  const seq = Array.isArray(identity) ? identity[identity.length - 1] as number : -1;
  const event = Number.isSafeInteger(seq) && seq > 0 ? core.data(core.current(bound.scope)).journal.at(seq - 1) : undefined;
  if (!event || event.eventId !== eventId || seq > state.scanned || seq <= state.cursor || typeof reason !== 'string' || !reason || reason.length > 4096) {
    throw new StorageInvalidCommandError('poison must identify a delivered unacknowledged event');
  }
  if (state.failedEvent !== null && state.failedEvent !== eventId) throw new StorageInvalidCommandError('an unresolved poison cannot be replaced');
  state.status = 'stalled'; state.failedEvent = eventId; state.failedReason = reason; state.failedSeq = seq;
  state.retryAuthorized = false; state.deliveredPoison = false;
};
export const pauseRootConsumer = (core: StagedCore, bound: ScopedRuntime, consumer: string, fence: JournalFence): void => {
  core.assertJournalFence(bound.grant, fence); journalConsumer(core, bound, consumer).status = 'paused';
};
export const retryRootConsumer = (core: StagedCore, bound: ScopedRuntime, consumer: string, expected: string | null, fence: JournalFence): void => {
  core.assertJournalFence(bound.grant, fence);
  const state = journalConsumer(core, bound, consumer);
  if (state.failedEvent !== expected) throw new StorageCasConflictError('failed event changed before retry');
  state.actions.push(Object.freeze({ by: bound.grant.principalId, eventId: expected, at: core.clock() }));
  state.status = 'running'; state.retryAuthorized = expected !== null; state.deliveredPoison = false;
};
export const captureRootSnapshot = (core: StagedCore, bound: ScopedRuntime, consumer: string, fence: JournalFence) => {
  core.assertJournalFence(bound.grant, fence); journalConsumer(core, bound, consumer);
  const root = core.current(bound.scope);
  const journalSeq = core.data(root).journal.length;
  const snapshotRoot = opaqueId('snapshot');
  core.control(bound.scope).snapshots.set(snapshotRoot, { root, journalSeq, consumer, ownerId: bound.grant.principalId, consumed: 0 });
  return { snapshotRoot, journalSeq };
};
