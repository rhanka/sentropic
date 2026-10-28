// In-memory host storage only; Engram's installed producer and hydration are real.
import { memoryJcs } from '../../src/engram-memory/codec.js';
import type { MemoryHostBinding } from '../../src/engram-memory/binding.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';
import { createMemoryNeutralHandle, type MemoryNeutralHostDriver,
  type MemoryNeutralKernelPort } from '../../src/engram-memory/neutral-handle.js';
import { g1Grant, g1ScopeBinding } from './g1-host.js';

export const receiptHydrationHost = () => {
  const grant = g1Grant();
  const scopeBinding = g1ScopeBinding();
  const aggregates = new Map<string, AtomicUnit['updates'][number]>();
  const indexes = new Map<string, AtomicUnit['indexWrites'][number]>();
  const journal: { id: string; hash: string; bytes: string }[] = [];
  const binding = { memoryGrant: grant } as MemoryHostBinding;
  const driver: MemoryNeutralHostDriver = {
    transaction: async (_options, operation) => operation({ execute: async ({ text }) => ({
      rows: text.startsWith('SELECT')
        ? [{ scope: JSON.stringify(scopeBinding.scope), store_id: scopeBinding.store_id }] : [],
    }) }),
  };
  const readAggregate = async (key: string) => aggregates.get(key) ?? null;
  const kernel: MemoryNeutralKernelPort = {
    ownership: { handle: { instanceId: 'receipt-host', storageEpoch: '1' },
      verify: async () => undefined, release: async () => undefined },
    provisionFence: async () => undefined,
    bind: async () => ({
      readAggregate,
      readCommitResult: async () => null,
      transact: async (_options, operation) => ({ value: await operation({
        readAggregate, readRecords: async () => [],
        readChain: async () => ({ records: journal }),
        findIdempotency: async ({ key }) => indexes.get(key) ?? null,
        apply: async (unit) => {
          for (const row of unit.updates) aggregates.set(row.key, structuredClone(row));
          for (const row of unit.appends) journal.push(structuredClone(row.record));
          for (const row of unit.indexWrites) indexes.set(row.key, structuredClone(row));
        },
      }), receipt: {} }),
      query: async (name, input) => {
        const after = BigInt((input as { after?: string }).after ?? '0');
        const events = journal.map((row) => JSON.parse(row.bytes) as Record<string, string>);
        if (name === 'memory-journal-page') return {
          records: events.filter((event) => BigInt(event.cursor!) > after),
        };
        if (name === 'scope-chain-index') {
          const last = events.at(-1);
          return { records: last ? [{ chainId: 'memory-journal',
            headHash: journal.at(-1)!.hash, allocation: last.cursor }] : [] };
        }
        return { records: [] };
      },
    }),
  };
  const assembly = createMemoryNeutralHandle({ kernel, binding, driver, schemaName: 'receipt_host' });
  const corruptCapture = async (receiptDigest: string | undefined) => {
    const key = JSON.stringify(['memory-capture-idempotency-v1', 'candidate-1']);
    const found = await assembly.handle.readAggregate('memory-capture-idempotency', key, grant);
    if (!found) throw new Error('capture must exist before corruption');
    const entry = JSON.parse(found.value.data);
    delete entry.receipt_digest;
    if (receiptDigest !== undefined) entry.receipt_digest = receiptDigest;
    await assembly.handle.transact({ grant, limits: { maxAppends: 0, maxRecords: 1, maxEncodedBytes: 4096 } },
      (tx) => tx.apply({ intentHash: 'corrupt-capture', guards: [], records: [], appends: [], relationships: [], barriers: [],
        purgeIntents: [], indexWrites: [], updates: [{ key, kind: found.kind,
          version: String(BigInt(found.version) + 1n), value: memoryJcs(entry) }] }));
  };
  return { ...assembly, grant, scopeBinding, aggregates, indexes, corruptCapture };
};
