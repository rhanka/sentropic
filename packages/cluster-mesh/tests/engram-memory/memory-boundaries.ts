import { expect, it } from 'vitest';
import { memoryJcs } from '../../src/engram-memory/codec.js';
import type { MemoryCampaignHost } from './memory-pg-host.js';
import { pendingCapture, valueOf } from './memory-corpus.js';
import { DEADLINE, DIGEST, memoryCaptureRequest, memoryEngine } from './memory-engine.js';

export const runMemoryBoundaryCorpus = (open: () => Promise<MemoryCampaignHost>) => {
  const scenario = (name: string, run: (h: MemoryCampaignHost) => Promise<void>) => it(name, async () => {
    const h = await open(); try { await run(h); } finally { await h.close(); }
  });
  scenario('immutable-boundaries-v1/accepted-snapshot: should preserve an exact accepted prefix as memory advances', async (h) => {
    const host = memoryEngine(h);
    const admit = async (sequence: string) => {
      const capture = valueOf(await host.engine.capture(memoryCaptureRequest(sequence)));
      return valueOf(await host.engine.requestAdmission({ candidate_id: capture.candidate_id!,
        authorization: { credential: 'credential-memory' }, deadline_at: DEADLINE }));
    };
    await admit('1');
    const input = { valid_as_of: 1, system_as_of: '2', authorization_receipt_digest: DIGEST, max_candidates: 10 };
    const first = valueOf(await h.store.acceptedSnapshot(input));
    expect(first.documents).toHaveLength(1);
    await admit('2');
    expect(valueOf(await h.store.acceptedSnapshot(input))).toMatchObject({
      system_as_of: '2', documents: first.documents, eligibility_digest: first.eligibility_digest,
    });
    expect(valueOf(await h.store.acceptedSnapshot({ ...input, system_as_of: '4' })).documents).toHaveLength(2);
    const page = JSON.parse((await h.handle.query('memory-accepted-snapshot', memoryJcs({
      system_as_of: '2', scope_ref: 'memory-stage-b-scope', max_candidates: 1,
    }), h.binding.memoryGrant)).data);
    expect(page.map((row: { record_id: string }) => row.record_id)).toEqual(first.documents.map((row) => row.record_id));
    await expect(h.handle.query('memory-accepted-snapshot', memoryJcs({ system_as_of: '4', max_candidates: 2001 }),
      h.binding.memoryGrant)).rejects.toMatchObject({ code: 'invalid-schema' });
    await h.reopen();
    expect(valueOf(await h.store.acceptedSnapshot(input))).toMatchObject({
      system_as_of: '2', documents: first.documents, eligibility_digest: first.eligibility_digest,
    });
    expect(valueOf(await h.store.readiness()).capabilities.detached_snapshot).toBe(false);
  });
  scenario('immutable-boundaries-v1/bounded-outbox: should exhaust single-batch pages and replay identical delivery after reopen', async (h) => {
    const host = memoryEngine(h);
    for (const sequence of ['1', '2']) {
      const capture = valueOf(await host.engine.capture(memoryCaptureRequest(sequence)));
      valueOf(await host.engine.requestAdmission({ candidate_id: capture.candidate_id!,
        authorization: { credential: 'credential-memory' }, deadline_at: DEADLINE }));
    }
    const cursors: string[] = []; const digests: string[] = [];
    let after = '0';
    for (;;) {
      const rows = JSON.parse((await h.handle.query('memory-outbox-page', memoryJcs({ after, limit: 1 }), h.binding.memoryGrant)).data);
      expect(rows.length).toBeLessThanOrEqual(1);
      if (!rows.length) break;
      expect(BigInt(rows[0].through_cursor_inclusive)).toBeGreaterThan(BigInt(after));
      after = rows[0].through_cursor_inclusive;
      cursors.push(after); digests.push(rows[0].batch_digest);
    }
    expect(cursors).toEqual(['2', '4']);
    expect(new Set(digests).size).toBe(2);
    const delivery = valueOf(await h.store.nextProjectionBatch({ after: '0', limit: 1 }));
    expect(delivery.through_cursor_inclusive).toBe('2');
    await expect(h.handle.query('memory-outbox-page', memoryJcs({ after: '0', limit: 2001 }), h.binding.memoryGrant))
      .rejects.toMatchObject({ code: 'invalid-schema' });
    await h.reopen();
    expect(valueOf(await h.store.nextProjectionBatch({ after: '0', limit: 1 }))).toEqual(delivery);
  });
  scenario('atomic-units-v1/rollback: should leave no effect or proof when the deferred ownership guard refuses COMMIT', async (h) => {
    h.expireAtCommit();
    expect(await h.store.commitPending(pendingCapture())).toMatchObject({ ok: false, error: { code: 'FENCE_LOST' } });
    await h.reopen();
    expect(valueOf(await h.store.readJournal({ after: '0', limit: 10 }))).toEqual([]);
    expect(await h.handle.readCommitResult!('capture-candidate-1', h.binding.memoryGrant)).toBeNull();
    expect(await h.store.readCaptureIdempotency!({ candidate_id: 'candidate-1' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(valueOf(await h.store.commitPending(pendingCapture())).cursor).toBe('1');
  });
};
