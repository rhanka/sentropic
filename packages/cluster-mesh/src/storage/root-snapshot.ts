import type { BackendChainState, BackendScopeState } from './backend.js';
import { StorageCapacityExceededError, StorageDeniedError, StorageInvalidCommandError } from './errors.js';
import { IndexedMap } from './indexed-map.js';
import type { ScopedRuntime } from './scope-runtime.js';
import { ownedCopy, type StagedCore } from './staged-core.js';
import { journalConsumer, validateJournalWindow } from './root-journal.js';
import { stagedLimits } from './staged-operations.js';

export interface SnapshotRow { readonly kind: 'chain' | 'index' | 'record' | 'aggregate' | 'genesis'; readonly key: string; readonly value: unknown; }
const sections = (root: BackendScopeState): readonly [SnapshotRow['kind'], Map<string, unknown>][] => [
  ['chain', root.chains], ['index', root.index], ['record', root.records], ['aggregate', root.aggregates], ['genesis', root.genesis],
];
export const readRootSnapshot = (core: StagedCore, bound: ScopedRuntime, token: string, after: number, limit: number) => {
  bound.requireOperation('read'); validateJournalWindow(core, after, limit);
  const captured = core.control(bound.scope).snapshots.get(token);
  if (!captured) throw new StorageInvalidCommandError('unknown snapshot capability');
  if (captured.ownerId !== bound.grant.principalId) throw new StorageDeniedError('snapshot belongs to another principal');
  const maps = sections(captured.root);
  const total = maps.reduce((sum, [, map]) => sum + map.size, 0);
  if (after > captured.consumed || after > total) throw new StorageInvalidCommandError('snapshot consumption must be contiguous');
  const current = core.current(bound.scope);
  const rows: SnapshotRow[] = [];
  let offset = after;
  let bytes = 0;
  for (let count = 0; offset < total && count < limit; count += 1) {
    let position = offset;
    for (const [kind, map] of maps) {
      if (position >= map.size) { position -= map.size; continue; }
      if (!(map instanceof IndexedMap)) throw new StorageInvalidCommandError('snapshot root lacks an ordinal index');
      const [key, value] = map.entryAt(position)!;
      if (core.accessible(current, key)) {
        // Histories are read separately under the captured chain head; a
        // snapshot row never embeds an unbounded history in one response.
        const chain = value as BackendChainState;
        const row: SnapshotRow = { kind, key, value: kind === 'chain' ? { head: chain.head, allocation: chain.allocation, disposed: chain.disposed } : value };
        const size = Buffer.byteLength(JSON.stringify(row), 'utf8');
        if (size > stagedLimits(core).maxEncodedBytes) throw new StorageCapacityExceededError('snapshot row exceeds the response budget');
        if (bytes + size > stagedLimits(core).maxEncodedBytes) return { rows: ownedCopy(rows), watermark: captured.journalSeq, next: offset };
        rows.push(row); bytes += size;
      }
      break;
    }
    offset += 1;
    captured.consumed = Math.max(captured.consumed, offset);
  }
  if (offset === total) {
    const consumer = journalConsumer(core, bound, captured.consumer);
    consumer.scanned = Math.max(consumer.scanned, captured.journalSeq);
  }
  return { rows: ownedCopy(rows), watermark: captured.journalSeq, next: offset < total ? offset : null };
};
