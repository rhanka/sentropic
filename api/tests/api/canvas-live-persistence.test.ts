import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgLiveDocumentStore } from '../../src/services/canvas-live/pg-store';
import { restoreDocument, sealCheckpoint } from '../../src/services/canvas-live/persistence';
import { admission, baseline, codec, commit, identity, intent, update } from '../helpers/canvas-live';

describe('canvas live PostgreSQL durability', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let id = { ...identity };
  let store: PgLiveDocumentStore;
  beforeAll(async () => {
    // Also exercise the branch migration when running against a fresh isolated DB.
    await pool.query(readFileSync(new URL('../../drizzle/0048_canvas_live_h2.sql', import.meta.url), 'utf8'));
  });
  beforeEach(async () => {
    id = { ...identity, documentId: `canvas:${randomUUID()}` };
    store = new PgLiveDocumentStore(pool);
    await store.open(id, baseline, '1');
  });
  afterAll(async () => { await pool.end(); });
  const input = (bytes: string | null, tx = 'tx-a') => {
    const value = commit(bytes, tx);
    value.receipt!.key.documentId = id.documentId;
    return value;
  };
  const checkpoint = (doc: ReturnType<typeof codec.create>, watermark: number) => sealCheckpoint({
    checkpointId: randomUUID(), documentId: id.documentId, encodedState: codec.encode(doc),
    stateVector: codec.vector(doc), journalWatermark: watermark, schemaEpoch: '1',
    createdAt: '2026-10-29T00:00:00Z', createdBy: 'host',
  });

  it.each(['before-journal', 'after-journal'] as const)('should roll back update and all records on %s crash', async phase => {
    const doc = codec.create();
    const value = input(update(doc, t => t.insert(0, 'candidate')));
    value.formattingIntents = [{ ...intent('format-a'), source: { kind: 'agent-patch', key: value.receipt!.key, operationIndex: 0 } }];
    store = new PgLiveDocumentStore(pool, point => { if (point === phase) throw new Error('crash'); });
    await expect(store.commit(id, 0, value)).rejects.toThrow('crash');
    const state = await new PgLiveDocumentStore(pool).load(id);
    expect(state.head).toBe(0);
    expect(state.journal).toEqual([]);
  });

  it.each(['before-checkpoint', 'after-checkpoint'] as const)('should retain journal recovery on %s crash', async phase => {
    const doc = codec.create();
    await store.commit(id, 0, input(update(doc, t => t.insert(0, 'abc'))));
    store = new PgLiveDocumentStore(pool, point => { if (point === phase) throw new Error('crash'); });
    await expect(store.checkpoint(id, 1, checkpoint(doc, 1))).rejects.toThrow('crash');
    const state = await new PgLiveDocumentStore(pool).load(id);
    expect(state.checkpoint).toBeNull();
    expect(codec.encode(restoreDocument(state, codec))).toBe(codec.encode(doc));
  });

  it('should recover checkpoint suffix receipts roster admissions freeze refusals and provenance after restart', async () => {
    const doc = codec.create();
    const first = input(update(doc, t => t.insert(0, 'abc')));
    first.formattingIntents = [{ ...intent('agent-intent'), source: { kind: 'agent-patch', key: first.receipt!.key, operationIndex: 0 } }];
    first.records = [
      { kind: 'admission', admission: { ...admission, ...id } },
      { kind: 'roster', actors: [{ actorId: 'agent-a', origin: 'agent:agent-a', awarenessClientId: 7 }] },
      { kind: 'acknowledgement', actorId: 'agent-a', sessionEpoch: 'epoch-a', digest: 'migration-ack' },
      { kind: 'freeze', returnId: 'return-a', lineageId: baseline.lineageId, head: null,
        excludedActorIds: ['offline-peer'], captureDigest: 'capture-a', pendingPublication: true },
      { kind: 'ingress-refusal', actorId: 'bad-actor', reason: 'scope-denied', payloadHash: 'bad-payload' },
      { kind: 'revert', key: first.receipt!.key, revertId: 'revert-a', revertedBy: 'human-a', receipt: { status: 'refused' } },
    ];
    await store.commit(id, 0, first);
    await store.checkpoint(id, 1, checkpoint(doc, 1));
    await store.commit(id, 1, input(update(doc, t => t.delete(1, 1)), 'delete'));
    const state = await new PgLiveDocumentStore(pool).load(id);
    expect(codec.encode(restoreDocument(state, codec))).toBe(codec.encode(doc));
    expect(state.journal[0]).toMatchObject(first);
    expect(state.baseline).toEqual(baseline);
    expect(state.schemaEpoch).toBe('1');
    expect(state.journal.map(e => e.seq)).toEqual([1, 2]);
  });

  it('should serialize writers and return exact duplicate receipts but refuse changed payloads', async () => {
    const doc = codec.create();
    const value = input(update(doc, t => t.insert(0, 'a')));
    const entries = await Promise.all([store.commit(id, 0, value), store.commit(id, 0, value)]);
    expect(entries[1]).toEqual(entries[0]);
    await expect(store.commit(id, 1, { ...value, encodedUpdate: 'different' })).rejects.toThrow('idempotency-conflict');
    await expect(store.commit(id, 0, input(null, 'other'))).rejects.toThrow('head-conflict');
    expect((await store.load(id)).head).toBe(1);
  });

  it('should deny recovery across tenant workspace and document boundaries', async () => {
    for (const other of [{ tenantId: 'other' }, { workspaceId: 'other' }, { documentId: 'other' }]) {
      await expect(store.load({ ...id, ...other })).rejects.toThrow('document-missing');
    }
    await store.open(id, { ...baseline, baseHash: 'peer-head' }, '1');
    expect((await store.load(id)).baseline).toEqual(baseline);
    await expect(store.open(id, baseline, '2')).rejects.toThrow('schema-epoch-conflict');
  });
});
