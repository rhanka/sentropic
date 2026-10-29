import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openModuleStorageCanonicalMemoryStoreV1 } from '@sentropic/engram/memory-substrate';
import type { NeutralAtomicUnit, NeutralWorkLimits } from '../../src/engram-memory/neutral-contract.js';
import { memoryCommitIndexKey } from '../../src/engram-memory/wire-adaptation.js';
import { MEMORY_NOW, pendingCapture, valueOf } from './memory-corpus.js';
import { receiptHydrationHost } from './receipt-hydration-host.js';

describe('installed Engram producer intent carriage', () => {
  it('should persist producer bytes and let Engram accept replay and refuse a tampered digest', async () => {
    const installed = JSON.parse(readFileSync(new URL('../package.json',
      import.meta.resolve('@sentropic/engram/memory-substrate')), 'utf8'));
    expect(installed.version).toBe('0.22.0');
    const h = receiptHydrationHost();
    const store = valueOf(await openModuleStorageCanonicalMemoryStoreV1({
      handle: h.handle, grant: h.grant, scope_binding: h.scopeBinding,
      clock: { now: () => MEMORY_NOW }, deadline_at: '2026-10-27T01:00:00.000Z',
    }));
    try {
      valueOf(await store.commitPending(pendingCapture()));
      expect(h.units).toHaveLength(1);
      const supplied = h.units[0]!;
      const [key, stored] = [...h.indexes.entries()].find(([key]) =>
        key.startsWith('["memory-host-commit-v1",'))!;
      const identity = JSON.parse(key)[1] as string;
      expect(key).toBe(memoryCommitIndexKey(identity));
      expect(typeof supplied.intentHash).toBe('string');
      expect(supplied.intentHash.length).toBeGreaterThan(0);
      expect(Buffer.from(stored.digest)).toEqual(Buffer.from(supplied.intentHash));
      const limits = { maxAppends: 10, maxRecords: 10, maxEncodedBytes: 1048576 };
      const read = await h.handle.transact({ grant: h.grant, limits },
        (tx) => tx.findIdempotency({ commitIdentity: identity }));
      expect(Buffer.from(read.value!.intentHash)).toEqual(Buffer.from(supplied.intentHash));
      // Exercise the installed comparison itself; no host copy of its formula.
      const commit = store as unknown as {
        commitUnit(operation: string, unit: NeutralAtomicUnit, identity: string,
          limits: NeutralWorkLimits): Promise<unknown>;
      };
      expect(await commit.commitUnit('capture', supplied, identity, limits))
        .toMatchObject({ ok: true, value: { committed: true } });
      expect(h.units).toHaveLength(1);
      const aggregatesBefore = structuredClone([...h.aggregates]);
      h.indexes.set(key, { ...stored, digest: `${stored.digest}tampered` });
      const tampered = await h.handle.transact({ grant: h.grant, limits },
        (tx) => tx.findIdempotency({ commitIdentity: identity }));
      expect(tampered.value!.intentHash).toBe(`${supplied.intentHash}tampered`);
      expect(await commit.commitUnit('capture', supplied, identity, limits))
        .toMatchObject({ ok: false, error: { code: 'DIGEST_CONFLICT', retryable: false,
          message: 'commit identity is bound to a different unit' } });
      expect(h.units).toHaveLength(1);
      expect([...h.aggregates]).toEqual(aggregatesBefore);
    } finally { valueOf(await store.close()); }
  });
});
