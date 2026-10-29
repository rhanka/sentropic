import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openModuleStorageCanonicalMemoryStoreV1 } from '@sentropic/engram/memory-substrate';
import { memoryJcs } from '../../src/engram-memory/codec.js';
import { translateMemoryAggregateRead } from '../../src/engram-memory/wire-adaptation.js';
import { MEMORY_DIGEST, MEMORY_NOW, pendingCapture, valueOf } from './memory-corpus.js';
import { receiptHydrationHost } from './receipt-hydration-host.js';

const installed = JSON.parse(readFileSync(new URL('../package.json',
  import.meta.resolve('@sentropic/engram/memory-substrate')), 'utf8'));

describe(`real installed Engram ${installed.version} receipt hydration`, () => {
  it.each([false, true])('should refuse divergent K7/control receipts after reopen (completed=%s)', async (completed) => {
    const h = receiptHydrationHost();
    const open = () => openModuleStorageCanonicalMemoryStoreV1({ handle: h.handle, grant: h.grant,
      scope_binding: h.scopeBinding, clock: { now: () => MEMORY_NOW },
      deadline_at: '2026-10-27T01:00:00.000Z' });
    const first = valueOf(await open());
    try {
      const receipt = valueOf(await first.commitPending(pendingCapture()));
      if (completed) valueOf(await first.recordCaptureIdempotency!({
        candidate_id: 'candidate-1', record_digest: MEMORY_DIGEST,
      }));
      valueOf(await first.close());
      // Positive control: all journal, fold, envelope and receipt checks pass.
      const matching = valueOf(await open());
      valueOf(await matching.readiness());
      valueOf(await matching.close());
      const controlKey = JSON.stringify(['memory-pending-control-v1', 'candidate-1']);
      const controlBefore = h.aggregates.get(controlKey)!.value.data;
      expect(JSON.parse(controlBefore).capture_receipt_digest).toBe(receipt.receipt_digest);
      const divergent = `sha256:${'b'.repeat(64)}`;
      expect(divergent).not.toBe(receipt.receipt_digest);
      // Go through the write translator: the old lossy adapter heals this
      // disagreement from control on read, making hydration accept it.
      await h.corruptCapture(divergent);
      expect(h.aggregates.get(controlKey)!.value.data).toBe(controlBefore);
      const key = JSON.stringify(['memory-capture-idempotency-v1', 'candidate-1']);
      const row = h.aggregates.get(key)!;
      const read = translateMemoryAggregateRead(key, row.value);
      const reopened = await open();
      expect(reopened).toMatchObject({ ok: false, error: { code: 'JOURNAL_CORRUPT', retryable: false,
        message: expect.stringContaining('capture idempotency') } });
      expect(JSON.parse(read.data).receipt_digest).toBe(divergent);
      const transactional = await h.handle.transact({ grant: h.grant,
        limits: { maxAppends: 0, maxRecords: 1, maxEncodedBytes: 4096 } },
      (tx) => tx.readAggregate('memory-capture-idempotency', key));
      expect(Buffer.from(transactional.value!.value.data)).toEqual(Buffer.from(read.data));
      console.info('E10A2_INSTALLED_HYDRATION', memoryJcs({ version: installed.version, completed,
        entry_receipt: divergent, control_receipt: receipt.receipt_digest, refusal: reopened }).data);
    } finally {
      const fence = h.getFence();
      if (fence) await h.handle.releaseFence(fence);
    }
  });
});
