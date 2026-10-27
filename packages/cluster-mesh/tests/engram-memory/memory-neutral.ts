// Host wire bridge only: preserve every memory value and decimal string.
// Validation, allocation, durability and authority remain in the real kernel.
import type { NeutralAtomicUnit, NeutralModuleTransaction } from '../../src/engram-memory/neutral-contract.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import type { KernelTransaction } from '../../src/storage/scope-runtime.js';
import { memoryJcs } from '../../src/engram-memory/codec.js';

export const memoryFailure = (error: unknown): never => {
  const source = error as { code?: string; message?: string };
  const codes: Record<string, string> = {
    denied: 'unauthorized', 'invalid-command': 'invalid-schema', unavailable: 'store-unavailable',
    'capacity-exceeded': 'limit-exceeded', 'idempotency-conflict': 'digest-conflict',
    'instance-busy': 'fence-conflict', 'stale-epoch': 'fence-lost', 'terminal-loss': 'fence-lost',
  };
  throw Object.assign(new Error(source.message ?? String(error)), { code: codes[source.code ?? ''] ?? source.code });
};
export const neutralUnitToPg = (unit: NeutralAtomicUnit): AtomicUnit => {
  if (unit.relationships.length || unit.barriers.length || unit.purgeIntents.length)
    throw Object.assign(new Error('unsupported memory effects'), { code: 'invalid-schema' });
  return {
    guards: unit.guards.map((guard) => guard.kind === 'aggregate-version'
      ? { kind: 'aggregate-version', key: guard.aggregateKey!, version: guard.version! }
      : guard.kind === 'chain-head' ? { kind: 'head', chainId: guard.chain!, hash: guard.hash! }
        : { kind: 'absent', chainId: guard.chain! }) as AtomicUnit['guards'],
    records: unit.records.map((row) => ({ key: row.key, bytes: row.value, contentHash: row.contentHash })),
    appends: unit.appends.map((row) => ({ chainId: row.chain,
      record: { id: row.id, hash: row.hash, bytes: row.value.data }, expectation: row.expectation })),
    updates: unit.updates.map((row) => ({ key: row.key, version: row.version, value: row.value })) as unknown as AtomicUnit['updates'],
    indexWrites: unit.indexWrites.map((row) => ({ key: row.key, digest: JSON.parse(row.value.data).record_digest ?? row.value.data,
      resultIds: [], resultHash: null })),
    relationships: [], barriers: [], purgeIntents: [], moduleResult: unit.moduleResult,
  };
};
const commitIndexKey = (identity: string) => JSON.stringify(['memory-host-commit-v1', identity]);
export const neutralTransaction = (tx: KernelTransaction, units: NeutralAtomicUnit[], identity?: string): NeutralModuleTransaction => ({
  readAggregate: async (kind, key) => {
    const found = await tx.readAggregate(key);
    return found === null ? null : { kind, key, version: String(found.version), value: found.value as { format: 'utf8'; data: string } };
  },
  readRecords: async (kind, keys) => (await tx.readRecords(keys, { maxRecords: 2000, maxEncodedBytes: 1048576 }))
    .map((row) => ({ kind, key: row.key, value: row.bytes as { format: 'utf8'; data: string }, contentHash: row.contentHash })),
  readChain: async ({ chain, afterAllocation = '0', limit }) => {
    const records = []; let cursor: unknown = null;
    do {
      const page = await tx.readChain({ chainId: chain, limit: Math.min(limit, 1024), cursor, maxEncodedBytes: 1048576 });
      if (page.outcome !== 'page') throw Object.assign(new Error('memory chain boundary unavailable'), { code: 'store-unavailable' });
      records.push(...page.records.filter((row) => BigInt(JSON.parse(row.bytes).cursor) > BigInt(afterAllocation))
        .map((row) => ({ id: row.id, hash: row.hash, value: { format: 'utf8' as const, data: row.bytes } })));
      cursor = page.nextCursor;
    } while (cursor !== null && records.length < limit);
    return { chain, records: records.slice(0, limit) };
  },
  findIdempotency: async ({ commitIdentity }) => {
    const row = await tx.findIdempotency({ key: commitIndexKey(commitIdentity) });
    return row ? { key: commitIdentity, intentHash: row.digest, moduleResult: JSON.parse(row.resultHash!) } : null;
  },
  apply: async (unit) => {
    const translated = neutralUnitToPg(unit);
    const appends = unit.appends.map((row) => row.id);
    const commitIndex = identity ? [{ key: commitIndexKey(identity),
      digest: memoryJcs({ appends, updates: [...appends, ...unit.updates.map((row) => row.key)] }).data,
      resultIds: [], resultHash: JSON.stringify(unit.moduleResult ?? memoryJcs(null)) }] : [];
    await tx.apply({ ...translated, indexWrites: [...translated.indexWrites, ...commitIndex] });
    units.push(structuredClone(unit));
  },
});

export const neutralQueryResult = (name: string, records: readonly unknown[]) => {
  if (name === 'scope-chain-index') {
    const row = records[0] as { chainId: string; headHash: string; allocation: string } | undefined;
    return memoryJcs(row ? { chain: row.chainId, head: row.headHash, allocation: row.allocation }
      : { chain: 'memory-journal', head: `sha256:${'0'.repeat(64)}`, allocation: '0' });
  }
  if (name === 'memory-journal-page') return memoryJcs(records.map((event: any) => ({
    id: event.event_id, hash: event.event_hash, value: memoryJcs(event),
  })));
  if (name === 'memory-record-by-id') return memoryJcs(records.length ? { found: true, value: memoryJcs(records[0]) } : { found: false });
  return memoryJcs(records);
};
