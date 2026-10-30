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
  const checkpoint = (doc: ReturnType<typeof codec.create>, watermark: number, checkpointId: string = randomUUID()) => sealCheckpoint({
    checkpointId, documentId: id.documentId, encodedState: codec.encode(doc),
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
      { kind: 'migration', target: 'preserved-draft', actorId: 'agent-a', sessionEpoch: 'epoch-a',
        origin: 'host:migration', fromSchemaEpoch: '0', toSchemaEpoch: '1', draftId: 'draft-a',
        beforeDigest: 'preserved-bytes', afterDigest: 'migrated-bytes' },
      { kind: 'roster', actors: [{ actorId: 'agent-a', origin: 'agent:agent-a', awarenessClientId: 7 }] },
      { kind: 'acknowledgement', actorId: 'agent-a', sessionEpoch: 'epoch-a', digest: 'migration-ack',
        profileId: 'prose', schemaEpoch: '1', draftId: 'draft-a' },
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
    expect(state.journal[0].formattingIntents).toMatchObject([{ intentId: 'agent-intent', seq: 1 }]);
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

  it('should isolate populated tenants and workspaces with identical collaboration identifiers', async () => {
    const scopes = [id, { ...id, tenantId: 'tenant-b' }, { ...id, workspaceId: 'workspace-b' }];
    const docs = scopes.map(() => codec.create());
    const values = docs.map((doc, index) => {
      const value = input(update(doc, text => text.insert(0, `scope-${index}`)));
      value.receipt!.payloadHash = `payload-${index}`;
      value.receipt!.detail = `receipt-${index}`;
      return value;
    });
    try {
      for (const scope of scopes) await store.open(scope, baseline, '1');
      for (const [index, scope] of scopes.entries()) {
        expect(await store.load(scope)).toMatchObject({ head: 0, journal: [], checkpoint: null });
        const entry = await store.commit(scope, 0, values[index]);
        expect(entry).toMatchObject({ ...values[index], seq: 1 });
      }
      const before = await Promise.all(scopes.map(scope => store.load(scope)));
      const cp = checkpoint(docs[0], 1);
      const checkpoints = docs.map(doc => checkpoint(doc, 1, cp.checkpointId));
      await store.checkpoint(scopes[0], 1, cp);
      expect((await store.load(scopes[0])).checkpoint).toEqual(cp);
      for (const index of [1, 2]) expect(await store.load(scopes[index])).toEqual(before[index]);

      // A retry is local even though all three scopes have the same transaction/patch key.
      expect(await store.commit(scopes[0], 0, values[0])).toEqual(before[0].journal[0]);
      const suffix = input(update(docs[0], text => text.insert(text.length, '-suffix')), 'tx-suffix');
      await store.commit(scopes[0], 1, suffix);
      for (const index of [1, 2]) expect(await store.load(scopes[index])).toEqual(before[index]);

      // Reuse the checkpoint identifier too: history lookup/insert must remain scoped.
      for (const index of [1, 2]) {
        await store.checkpoint(scopes[index], 1, checkpoints[index]);
        expect((await store.load(scopes[index])).checkpoint).toEqual(checkpoints[index]);
      }
      const restarted = new PgLiveDocumentStore(pool);
      for (const [index, scope] of scopes.entries()) {
        const state = await restarted.load(scope);
        expect(state.identity).toEqual(scope);
        expect(state.head).toBe(index === 0 ? 2 : 1);
        expect(state.journal).toHaveLength(state.head);
        expect(state.journal[0]).toEqual(before[index].journal[0]);
        expect(state.journal.map(entry => entry.receipt)).toEqual(index === 0
          ? [values[0].receipt, suffix.receipt] : [values[index].receipt]);
        expect(state.checkpoint).toEqual(checkpoints[index]);
        const history = await pool.query(`SELECT body FROM canvas_live_checkpoints
          WHERE tenant_id=$1 AND workspace_id=$2 AND document_id=$3`, [scope.tenantId, scope.workspaceId, scope.documentId]);
        expect(history.rows.map(row => row.body)).toEqual([checkpoints[index]]);
        const restored = restoreDocument(state, codec);
        expect(restored.getText('field:body').toString()).toBe(`scope-${index}${index === 0 ? '-suffix' : ''}`);
        expect(codec.encode(restored)).toBe(codec.encode(docs[index]));
        codec.destroy(restored);
      }
    } finally {
      docs.forEach(codec.destroy);
    }
  });

  it('should recover a committed journal and checkpoint even when their acknowledgement is lost', async () => {
    const doc = codec.create();
    const value = input(update(doc, t => t.insert(0, 'committed')));
    const crashing = new PgLiveDocumentStore(pool, phase => { if (phase === 'after-commit') throw new Error('lost-ack'); });
    await expect(crashing.commit(id, 0, value)).rejects.toThrow('lost-ack');
    expect((await store.load(id)).journal[0].receipt).toEqual(value.receipt);
    const cp = checkpoint(doc, 1);
    await expect(crashing.checkpoint(id, 1, cp)).rejects.toThrow('lost-ack');
    const state = await store.load(id);
    expect(state.checkpoint).toEqual(cp);
    expect(codec.encode(restoreDocument(state, codec))).toBe(codec.encode(doc));
    expect(await store.commit(id, 0, value)).toEqual(state.journal[0]);
  });
});
