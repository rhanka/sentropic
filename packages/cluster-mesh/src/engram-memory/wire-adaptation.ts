// engram-memory K7/K8 wire adaptation (E10a): the frozen Engram substrate
// persists proofs and journal events in snake-case wire form while the
// installed kernel validator checks the camel-case proof model. These pure
// helpers translate both ways at the neutral-handle boundary; validation,
// allocation, durability and authority remain in the real kernel.

import { memoryJcs, type MemoryEncodedValue } from './codec.js';
import { StorageInvalidCommandError } from '../storage/errors.js';
import type { AtomicUnit } from '../storage/atomic.js';
import type {
  NeutralAggregateUpdate, NeutralAtomicUnit,
} from './neutral-contract.js';

export const memoryNeutralFailure = (error: unknown): never => {
  const source = (error ?? {}) as { code?: string; message?: string };
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

/** K7 write direction: snake-case substrate proof to camel-case kernel proof. */
export const captureProofToKernel = (entry: Record<string, unknown>): Record<string, unknown> => ({
  candidateId: entry['candidate_id'],
  revision: entry['record_digest'] ? 2 : 1,
  recordDigest: entry['record_digest'] ?? null,
  createdCursor: entry['cursor'],
  proof: { candidate_id: entry['candidate_id'], content: entry['content'], cursor: entry['cursor'] },
});

/** K7 read direction: camel-case kernel proof back to snake-case wire proof. */
export const captureProofToWire = (stored: Record<string, unknown>): Record<string, unknown> => {
  const proof = (stored['proof'] ?? {}) as Record<string, unknown>;
  return { ...proof, ...(stored['recordDigest'] ? { record_digest: stored['recordDigest'] } : {}) };
};

export const translateMemoryUpdateWrite = (row: NeutralAggregateUpdate): NeutralAggregateUpdate => {
  if (!isMemoryCaptureKey(row.key) && !isMemoryOutcomeKey(row.key)) return row;
  const entry = parseStored(row.value.data);
  if (isMemoryCaptureKey(row.key)) {
    if (typeof entry['candidateId'] === 'string') return row;
    return { ...row, value: memoryJcs(captureProofToKernel(entry)) };
  }
  if (typeof entry['candidateId'] === 'string') return row;
  return { ...row, value: memoryJcs({ candidateId: entry['candidate_id'], outcome: entry['status'], proof: entry }) };
};

export const translateMemoryAggregateRead = (
  key: string, value: MemoryEncodedValue,
): MemoryEncodedValue => {
  if (!isMemoryCaptureKey(key) && !isMemoryOutcomeKey(key)) return value;
  const parsed = parseStored(value.data);
  if (isMemoryCaptureKey(key)) {
    if (typeof parsed['candidate_id'] === 'string') return value;
    return memoryJcs(captureProofToWire(parsed));
  }
  if (typeof parsed['candidate_id'] === 'string') return value;
  return memoryJcs(parsed['proof']);
};

/** Rejoin the K7 receipt digest carried only in the pending control bytes. */
export const withMemoryCaptureReceipt = async (
  key: string,
  value: MemoryEncodedValue,
  readControl: (controlKey: string) => Promise<MemoryEncodedValue | null>,
): Promise<MemoryEncodedValue> => {
  const translated = translateMemoryAggregateRead(key, value);
  if (!isMemoryCaptureKey(key)) return translated;
  const entry = parseStored(translated.data);
  if (typeof entry['receipt_digest'] === 'string') return translated;
  const candidateId = (JSON.parse(key) as unknown[])[1];
  const control = await readControl(JSON.stringify(['memory-pending-control-v1', candidateId]));
  if (!control) return translated;
  const receiptDigest = parseStored(control.data)['capture_receipt_digest'];
  return typeof receiptDigest === 'string'
    ? memoryJcs({ ...entry, receipt_digest: receiptDigest }) : translated;
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
