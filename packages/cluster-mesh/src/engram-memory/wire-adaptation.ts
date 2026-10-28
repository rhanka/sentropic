// engram-memory K7/K8 wire adaptation (E10a): the frozen Engram substrate
// persists proofs and journal events in snake-case wire form while the
// installed kernel validator checks the camel-case proof model. These pure
// helpers translate both ways at the neutral-handle boundary; validation,
// allocation, durability and authority remain in the real kernel.

import { isCanonicalU64, MemoryCanonicalJsonError, memoryJcs, type MemoryEncodedValue } from './codec.js';
import { isMemoryAdmissionOutcome, isMemoryCaptureProof } from './validation.js';
import { StorageInvalidCommandError } from '../storage/errors.js';
import type { AtomicUnit } from '../storage/atomic.js';
import type { EncodedValue } from '../storage/contracts.js';
import type {
  NeutralAggregateUpdate, NeutralAtomicUnit, NeutralModuleTransaction,
} from './neutral-contract.js';

export const memoryNeutralFailure = (error: unknown): never => {
  const source = error instanceof MemoryCanonicalJsonError
    ? { code: 'invalid-schema', message: error.message }
    : (error ?? {}) as { code?: string; message?: string };
  const codes: Record<string, string> = {
    denied: 'unauthorized', 'invalid-command': 'invalid-schema', unavailable: 'store-unavailable',
    'capacity-exceeded': 'limit-exceeded', 'idempotency-conflict': 'digest-conflict',
    'instance-busy': 'fence-conflict', 'stale-epoch': 'fence-lost', 'terminal-loss': 'fence-lost',
  };
  throw Object.assign(new Error(source.message ?? String(error)), { code: codes[source.code ?? ''] ?? source.code });
};

export const memoryCommitIndexKey = (identity: string): string =>
  JSON.stringify(['memory-host-commit-v1', identity]);
export const isMemoryCaptureKey = (key: string): boolean =>
  key.startsWith('["memory-capture-idempotency-v1",');
export const isMemoryOutcomeKey = (key: string): boolean =>
  key.startsWith('["memory-admission-outcome-v1",');

const parseStored = (data: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new StorageInvalidCommandError('memory wire value must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof StorageInvalidCommandError) throw error;
    throw new StorageInvalidCommandError('memory wire value must be JSON bytes');
  }
};

export const requireMemoryUtf8 = (value: EncodedValue): MemoryEncodedValue => {
  if (value.format !== 'utf8') throw new StorageInvalidCommandError('memory wire value must be UTF-8');
  return { format: 'utf8', data: value.data };
};

const requireWire = (ok: boolean, what: string): void => {
  if (!ok) throw new StorageInvalidCommandError(`memory wire proof is malformed: ${what}`);
};
const requireSnake = (entry: Record<string, unknown>, capture: boolean): void => {
  requireWire(typeof entry['candidate_id'] === 'string' && entry['candidate_id'] !== '', 'candidate_id');
  if (!capture) { requireWire('status' in entry, 'admission outcome'); return; }
  requireWire(typeof entry['cursor'] === 'string', 'cursor');
  requireWire('content' in entry, 'content');
  requireWire(entry['record_digest'] === undefined || typeof entry['record_digest'] === 'string', 'record_digest');
};
const requireKernel = (entry: Record<string, unknown>, capture: boolean): void => {
  requireWire(capture ? isMemoryCaptureProof(entry) : isMemoryAdmissionOutcome(entry), 'stored proof');
};

/** K7 write direction: snake-case substrate proof to camel-case kernel proof. */
export const captureProofToKernel = (entry: Record<string, unknown>): Record<string, unknown> => {
  requireSnake(entry, true);
  // Only the completion field is mutable; keep every other producer field.
  const { record_digest: recordDigest, ...proof } = entry;
  return {
    candidateId: entry['candidate_id'],
    revision: recordDigest !== undefined ? 2 : 1,
    recordDigest: recordDigest ?? null,
    createdCursor: entry['cursor'],
    proof,
  };
};

/** K7 read direction: camel-case kernel proof back to snake-case wire proof. */
export const captureProofToWire = (stored: Record<string, unknown>): Record<string, unknown> => {
  requireKernel(stored, true);
  const proof = (stored['proof'] ?? {}) as Record<string, unknown>;
  return { ...proof, ...(stored['recordDigest'] !== null ? { record_digest: stored['recordDigest'] } : {}) };
};

export const translateMemoryUpdateWrite = (row: NeutralAggregateUpdate): NeutralAggregateUpdate => {
  if (!isMemoryCaptureKey(row.key) && !isMemoryOutcomeKey(row.key)) return row;
  const entry = parseStored(row.value.data);
  if (typeof entry['candidateId'] === 'string') {
    requireKernel(entry, isMemoryCaptureKey(row.key)); return row;
  }
  requireSnake(entry, isMemoryCaptureKey(row.key));
  if (isMemoryCaptureKey(row.key)) {
    return { ...row, value: memoryJcs(captureProofToKernel(entry)) };
  }
  return { ...row, value: memoryJcs({ candidateId: entry['candidate_id'], outcome: entry['status'], proof: entry }) };
};

export const translateMemoryAggregateRead = (
  key: string, storedValue: EncodedValue,
): MemoryEncodedValue => {
  const value = requireMemoryUtf8(storedValue);
  if (!isMemoryCaptureKey(key) && !isMemoryOutcomeKey(key)) return value;
  const parsed = parseStored(value.data);
  if (typeof parsed['candidate_id'] === 'string') {
    requireSnake(parsed, isMemoryCaptureKey(key)); return value;
  }
  requireKernel(parsed, isMemoryCaptureKey(key));
  if (isMemoryCaptureKey(key)) {
    return memoryJcs(captureProofToWire(parsed));
  }
  return memoryJcs(parsed['proof']);
};

/** Journal append bytes: carry the intent hash in stored bytes only. */
export const journalBytesWithIntentHash = (valueData: string, fallbackHash: string): string => {
  const event = parseStored(valueData);
  if (typeof event['intent_hash'] === 'string') return valueData;
  return memoryJcs({ ...event, intent_hash: event['event_digest'] ?? fallbackHash }).data;
};

/** Journal read bytes: the intent hash never leaves the stored form. */
export const stripJournalIntentHash = (data: string): string => {
  const event = parseStored(data);
  if (!('intent_hash' in event)) return data;
  const { intent_hash: _intentHash, ...rest } = event;
  return memoryJcs(rest).data;
};

export const neutralUnitToPg = (unit: NeutralAtomicUnit): AtomicUnit => {
  if (unit.relationships.length || unit.barriers.length || unit.purgeIntents.length) {
    throw Object.assign(new Error('unsupported memory effects'), { code: 'invalid-schema' });
  }
  return {
    guards: unit.guards.map((guard) => guard.kind === 'aggregate-version'
      ? { kind: 'aggregate-version', key: guard.aggregateKey!, version: Number(guard.version) }
      : guard.kind === 'chain-head' ? { kind: 'head', chainId: guard.chain!, hash: guard.hash! }
        : { kind: 'absent', chainId: guard.chain! }),
    records: unit.records.map((row) => ({ key: row.key, bytes: row.value, contentHash: row.contentHash })),
    appends: unit.appends.map((row) => ({
      chainId: row.chain,
      record: { id: row.id, hash: row.hash, bytes: journalBytesWithIntentHash(row.value.data, row.hash) },
      expectation: row.expectation,
    })),
    updates: unit.updates.map((row) => {
      const translated = translateMemoryUpdateWrite(row);
      return { key: translated.key, version: Number(translated.version), value: translated.value };
    }),
    indexWrites: unit.indexWrites.map((row) => ({
      key: row.key,
      digest: parseStored(row.value.data)['record_digest'] as string ?? row.value.data,
      resultIds: [], resultHash: null,
    })),
    relationships: [], barriers: [], purgeIntents: [], moduleResult: unit.moduleResult,
  };
};

/** Structural kernel transaction port consumed by the neutral transaction. */
export interface MemoryKernelTransactionPort {
  readAggregate(key: string): Promise<{ readonly version: number; readonly value: EncodedValue } | null>;
  readRecords(
    keys: readonly string[], limits: { readonly maxRecords: number; readonly maxEncodedBytes: number },
  ): Promise<readonly { readonly key: string; readonly bytes: EncodedValue; readonly contentHash: string }[]>;
  readChain(input: {
    readonly chainId: string; readonly limit: number; readonly cursor?: unknown; readonly maxEncodedBytes: number;
  }): Promise<{ readonly records: readonly { readonly id: string; readonly hash: string; readonly bytes: string }[];
    readonly nextCursor?: unknown }>;
  findIdempotency(selector: { readonly key: string }):
    Promise<{ readonly digest: string; readonly resultHash: string | null } | null>;
  apply(unit: AtomicUnit): Promise<void>;
}

export const createMemoryNeutralTransaction = (
  tx: MemoryKernelTransactionPort,
  options: { readonly units?: NeutralAtomicUnit[]; readonly identity?: string } = {},
): NeutralModuleTransaction => ({
  readAggregate: async (kind, key) => {
    const found = await tx.readAggregate(key);
    if (found === null) return null;
    const value = translateMemoryAggregateRead(key, found.value);
    return { kind, key, version: String(found.version), value };
  },
  readRecords: async (kind, keys) => (await tx.readRecords(keys, { maxRecords: 2000, maxEncodedBytes: 1048576 }))
    .map((row) => ({ kind, key: row.key, value: requireMemoryUtf8(row.bytes), contentHash: row.contentHash })),
  readChain: async ({ chain, afterAllocation = '0', limit }) => {
    if (!isCanonicalU64(afterAllocation) || !Number.isSafeInteger(limit) || limit <= 0 || limit > 2000) {
      throw new StorageInvalidCommandError('memory chain requires a canonical allocation and limit from 1 to 2000');
    }
    const after = BigInt(afterAllocation);
    const records: { id: string; hash: string; value: MemoryEncodedValue }[] = [];
    let cursor: unknown;
    for (;;) {
      const page = await tx.readChain({ chainId: chain, limit: Math.min(500, limit - records.length),
        cursor, maxEncodedBytes: 1048576 });
      for (const row of page.records) {
        const data = stripJournalIntentHash(row.bytes);
        const allocation = parseStored(data)['cursor'];
        if (!isCanonicalU64(allocation)) {
          throw new StorageInvalidCommandError('memory chain record requires a canonical cursor');
        }
        if (BigInt(allocation) > after) {
          records.push({ id: row.id, hash: row.hash, value: { format: 'utf8', data } });
          if (records.length === limit) return { chain, records };
        }
      }
      if (!page.nextCursor || page.records.length === 0) break;
      cursor = page.nextCursor;
    }
    return { chain, records };
  },
  findIdempotency: async ({ commitIdentity }) => {
    const row = await tx.findIdempotency({ key: memoryCommitIndexKey(commitIdentity) });
    return row
      ? { key: commitIdentity, intentHash: row.digest,
          moduleResult: JSON.parse(row.resultHash ?? 'null') as MemoryEncodedValue }
      : null;
  },
  apply: async (unit) => {
    const translated = neutralUnitToPg(unit);
    const appends = unit.appends.map((row) => row.id);
    const commitIndex = options.identity ? [{
      key: memoryCommitIndexKey(options.identity),
      digest: memoryJcs({ appends, updates: [...appends, ...unit.updates.map((row) => row.key)] }).data,
      resultIds: [] as string[], resultHash: JSON.stringify(unit.moduleResult ?? memoryJcs(null)),
    }] : [];
    await tx.apply({ ...translated, indexWrites: [...translated.indexWrites, ...commitIndex] });
    options.units?.push(structuredClone(unit));
  },
});

export const neutralQueryResult = (name: string, records: readonly unknown[]): MemoryEncodedValue => {
  if (name === 'scope-chain-index') {
    const row = records[0] as { chainId: string; headHash: string; allocation: string } | undefined;
    return memoryJcs(row ? { chain: row.chainId, head: row.headHash, allocation: row.allocation }
      : { chain: 'memory-journal', head: `sha256:${'0'.repeat(64)}`, allocation: '0' });
  }
  if (name === 'memory-journal-page') {
    return memoryJcs(records.map((event) => {
      const stored = event as Record<string, unknown> & { event_id: string; event_hash: string };
      const { intent_hash: _intentHash, ...rest } = stored;
      return { id: stored.event_id, hash: stored.event_hash, value: memoryJcs(rest) };
    }));
  }
  if (name === 'memory-record-by-id') {
    return memoryJcs(records.length ? { found: true, value: memoryJcs(records[0]) } : { found: false });
  }
  return memoryJcs(records);
};
