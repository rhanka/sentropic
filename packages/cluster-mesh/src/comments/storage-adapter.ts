import { CanonicalCommandError } from '@sentropic/comments';
import type { CanonicalChainRecord, CanonicalReadSelection, CanonicalStoreScope, CanonicalPageRequest, CanonicalReadPage, ExpectedState, CapacityDescriptor, CommittedCommand } from '@sentropic/comments';
import type { KernelTransaction } from '../storage/scope-runtime.js';
import { emptyEffects } from '../storage/staged-preparation.js';
import { CommentsContext, StoredGenesisReplay, type CommentsRequest } from './context.js';
import { canonicalRecordKey, chainIdentity, commandKey, decodeRecord, invalid, own, validateRecordIdentity } from './storage-schema.js';
import { validateCommentsRecord } from './record-validation.js';
import { commentsRecordEffects } from './record-effects.js';
export class CommentsAdapter {
  constructor(readonly context: CommentsContext, readonly capacity: CapacityDescriptor) {}
  async lookup(request: CommentsRequest, tx: KernelTransaction | null, selection: CanonicalReadSelection, hash?: string): Promise<CanonicalChainRecord | null> {
    const chain = chainIdentity(selection).key;
    const head = hash ?? await (tx ? tx.readHead(chain) : request.storage.readHead(chain));
    if (head === null) return null;
    // Even an exact historical reference must check current chain coverage.
    if (hash !== undefined) await (tx ? tx.readHead(chain) : request.storage.readHead(chain));
    const key = canonicalRecordKey(chain, head); const found = await (tx ? tx.readRecord(key) : request.storage.readRecord(key));
    if (!found) { if (hash !== undefined) return null; return invalid('canonical head has no full record'); }
    const record = decodeRecord(found.bytes.data, found.contentHash);
    validateRecordIdentity(request.grant.scope, selection, record); return record;
  }
  head<T extends CanonicalChainRecord>(scope: CanonicalStoreScope, selection: CanonicalReadSelection): Promise<T | null> {
    return this.context.invoke(scope, (request, tx) => this.lookup(request, tx, selection) as Promise<T | null>);
  }
  append<T extends CanonicalChainRecord>(scope: CanonicalStoreScope, selection: CanonicalReadSelection, supplied: T, expected?: ExpectedState): Promise<T> {
    return this.context.invoke(scope, (request) => this.context.mutate(async (tx, standalone) => {
      const record = own(supplied); validateRecordIdentity(scope, selection, record);
      const previous = await this.lookup(request, tx, selection);
      if (expected === undefined && previous) {
        if (previous.hash !== record.hash) throw new CanonicalCommandError('idempotency-conflict', 'Genesis identity has different content');
        if (standalone) throw new StoredGenesisReplay(previous);
        return previous as T;
      }
      if (expected && (expected.kind === 'creation' ? previous !== null || expected.aggregateVersion !== 0 : expected.kind !== 'revision' || previous?.hash !== expected.revisionHash)) throw new CanonicalCommandError('cas-conflict', 'Canonical head changed');
      if ('link' in record && (record.link.previousHash !== (previous?.hash ?? null) || record.link.sequence !== (previous && 'link' in previous ? previous.link.sequence + 1 : 1))) throw new CanonicalCommandError('cas-conflict', 'Canonical link does not extend the current head');
      await validateCommentsRecord(record, previous, this.capacity, (selected, hash) => this.lookup(request, tx, selected, hash));
      await tx.apply(commentsRecordEffects(selection, record, previous?.hash ?? null));
      return own(record);
    }));
  }
  page(scope: CanonicalStoreScope, selection: CanonicalReadSelection, supplied: CanonicalPageRequest): Promise<CanonicalReadPage> {
    return this.context.invoke(scope, async (request, tx) => {
      const page = own(supplied); const chainId = chainIdentity(selection).key;
      if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 100 || (page.cursor !== null && typeof page.cursor !== 'string')) invalid('invalid canonical page request');
      const result = tx ? await tx.readChain({ chainId, ...page, maxEncodedBytes: 1048576 }) : await request.storage.readPage(chainId, page.limit, page.cursor, 1048576);
      return { outcome: result.outcome, records: result.records.map((record) => decodeRecord(record.bytes, record.hash)), nextCursor: result.nextCursor };
    });
  }
  chain<T extends CanonicalChainRecord>(scope: CanonicalStoreScope, selection: CanonicalReadSelection): Promise<readonly T[]> {
    return this.context.invoke(scope, async () => {
      const records: T[] = []; let cursor: string | null = null;
      do {
        const page = await this.page(scope, selection, { limit: 100, cursor });
        if (page.outcome !== 'page') throw new CanonicalCommandError('denied', 'Complete canonical chain is unavailable');
        records.push(...page.records as T[]); cursor = page.nextCursor;
      } while (cursor !== null);
      return records;
    });
  }
  find(scope: CanonicalStoreScope, key: string): Promise<CommittedCommand | null> {
    return this.context.invoke(scope, (_request, tx) => tx ? tx.findIdempotency({ key: commandKey(key) }) : _request.storage.indexGet(commandKey(key)));
  }
  record(scope: CanonicalStoreScope, key: string, supplied: CommittedCommand): Promise<void> {
    return this.context.invoke(scope, () => this.context.mutate(async (tx) => {
      const committed = own(supplied); await tx.apply({ ...emptyEffects(), indexWrites: [{ key: commandKey(key), ...committed }] });
    }));
  }
}
