import { describe, expect, it } from 'vitest';
import type { CanonicalMemoryStorePort, Result } from '@sentropic/engram/memory-substrate';
import { memoryJcs } from '../../src/engram-memory/codec.js';
import { MEMORY_PINNED_PROFILES } from '../../src/engram-memory/manifest.js';
import type { MemoryCampaignHost } from './memory-pg-host.js';

export const MEMORY_STAGE_B_PROFILES = [
  'atomic-units-v1', 'immutable-chains-v1', 'immutable-boundaries-v1', 'scope-outbox-v1', 'fenced-writers-v1',
] as const;
export const MEMORY_STAGE_B_CASES = {
  'atomic-units-v1': ['capture-completion', 'completion-conflict', 'rollback'],
  'immutable-chains-v1': ['first-proof-reopen', 'destruction-replay'],
  'immutable-boundaries-v1': ['bounded-journal', 'bounded-outbox', 'accepted-snapshot'],
  'scope-outbox-v1': ['checkpoint-resync-snapshot', 'poison-retry', 'authority-refusals'],
  'fenced-writers-v1': ['second-holder', 'store-bijection', 'revocation', 'two-process', 'final-guard'],
} as const;
export const MEMORY_NOW = '2026-10-27T00:00:00.000Z';
export const MEMORY_DIGEST = `sha256:${'a'.repeat(64)}` as const;
export const valueOf = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
export const pendingCapture = (candidateId = 'candidate-1'): Parameters<CanonicalMemoryStorePort['commitPending']>[0] => ({
  control: { candidate_id: candidateId, envelope_digest: MEMORY_DIGEST, state: 'pending', created_cursor: '0',
    policy_id: 'policy-memory', policy_version: '1', capture_content_digest: MEMORY_DIGEST, capture_receipt_digest: MEMORY_DIGEST },
  sealed: { candidate_id: candidateId, envelope_ref: `envelope-${candidateId}`, envelope_digest: MEMORY_DIGEST,
    key_ref: `key-${candidateId}`, ciphertext: `ciphertext-${candidateId}` },
  capture_event: { schema_version: 2, event_id: `capture-${candidateId}`, cursor: '0', recorded_at: MEMORY_NOW,
    operation: 'capture', candidate_id: candidateId, to_state: 'pending', authorization_receipt_digest: MEMORY_DIGEST,
    previous_event_digest: MEMORY_DIGEST, event_digest: MEMORY_DIGEST },
});

export const runMemoryCorpus = (open: () => Promise<MemoryCampaignHost>): void => {
  const scenario = (name: string, run: (host: MemoryCampaignHost) => Promise<void>) => it(name, async () => {
    const host = await open();
    try { await run(host); } finally { await host.close(); }
  });
  describe('memory Stage B: exact read/write binding and separate host maintenance', () => {
    scenario('inventory: should negotiate all five frozen semantic profiles with no maintenance escape', async (h) => {
      expect(h.binding.memoryGrant.operations).toEqual(['read', 'write']);
      expect(h.binding.maintainGrant.operations).toEqual(['maintain']);
      expect(h.handle.profiles).toEqual(MEMORY_PINNED_PROFILES);
      expect(h.handle.profiles.map((claim) => claim.name)).toEqual(MEMORY_STAGE_B_PROFILES);
      for (const name of ['checkpoint', 'journalCheckpoint', 'snapshot', 'snapshotRead', 'resync', 'maintainGrant'])
        expect(name in h.handle).toBe(false);
      expect(valueOf(await h.store.readiness()).storage_epoch).toBe('1');
    });
    scenario('atomic-units-v1/capture-completion: should complete K7 without allocating another cursor', async (h) => {
      const receipt = valueOf(await h.store.commitPending(pendingCapture()));
      expect(receipt.cursor).toBe('1');
      const complete = { candidate_id: 'candidate-1', record_digest: MEMORY_DIGEST };
      valueOf(await h.store.recordCaptureIdempotency!(complete));
      const proof = valueOf(await h.store.readCaptureIdempotency!({ candidate_id: 'candidate-1' }));
      expect(proof).toMatchObject({ record_digest: MEMORY_DIGEST });
      expect(valueOf(await h.store.readJournal({ after: '0', limit: 10 }))).toHaveLength(1);
      expect(h.units.at(-1)?.appends).toEqual([]);
      expect(h.units.at(-1)?.updates[0]?.version).toBe('2');
      const count = h.units.length;
      valueOf(await h.store.recordCaptureIdempotency!(complete));
      expect(h.units).toHaveLength(count);
    });
    scenario('atomic-units-v1/completion-conflict: should preserve the first completed digest', async (h) => {
      valueOf(await h.store.commitPending(pendingCapture()));
      valueOf(await h.store.recordCaptureIdempotency!({ candidate_id: 'candidate-1', record_digest: MEMORY_DIGEST }));
      const first = valueOf(await h.store.readCaptureIdempotency!({ candidate_id: 'candidate-1' }));
      expect(await h.store.recordCaptureIdempotency!({ candidate_id: 'candidate-1', record_digest: `sha256:${'b'.repeat(64)}` }))
        .toMatchObject({ ok: false, error: { code: 'DIGEST_CONFLICT' } });
      expect(valueOf(await h.store.readCaptureIdempotency!({ candidate_id: 'candidate-1' }))).toEqual(first);
    });
    scenario('immutable-chains-v1/first-proof-reopen: should replay original receipt bytes in a new epoch', async (h) => {
      const input = pendingCapture();
      const original = valueOf(await h.store.commitPending(input));
      valueOf(await h.store.recordCaptureIdempotency!({ candidate_id: 'candidate-1', record_digest: MEMORY_DIGEST }));
      const proof = valueOf(await h.store.readCaptureIdempotency!({ candidate_id: 'candidate-1' }));
      await h.reopen();
      expect(valueOf(await h.store.readiness()).storage_epoch).toBe('2');
      expect(valueOf(await h.store.commitPending(input))).toEqual(original);
      expect(valueOf(await h.store.readCaptureIdempotency!({ candidate_id: 'candidate-1' }))).toEqual(proof);
      expect(valueOf(await h.store.readJournal({ after: '0', limit: 10 }))).toHaveLength(1);
    });
    scenario('immutable-boundaries-v1/bounded-journal: should exhaust bounded pages without duplicates', async (h) => {
      for (const id of ['candidate-1', 'candidate-2', 'candidate-3']) valueOf(await h.store.commitPending(pendingCapture(id)));
      let after = '0'; const cursors: string[] = [];
      for (;;) {
        const page = JSON.parse((await h.handle.query('memory-journal-page', memoryJcs({ after, limit: 1 }), h.binding.memoryGrant)).data);
        expect(page.length).toBeLessThanOrEqual(1);
        if (!page.length) break;
        after = JSON.parse(page[0].value.data).cursor;
        cursors.push(after);
      }
      expect(cursors).toEqual(['1', '2', '3']);
      await expect(h.handle.query('memory-journal-page', memoryJcs({ after: '0', limit: 2001 }), h.binding.memoryGrant))
        .rejects.toMatchObject({ code: 'invalid-schema' });
    });
  });
};
