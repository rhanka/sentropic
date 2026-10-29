import { describe, expect, it, vi } from 'vitest';
import { DraftRecovery, type PreservedDraft } from '../../src/services/canvas-live/recovery';
import * as Y from 'yjs';
import { restoreDocument, sealCheckpoint } from '../../src/services/canvas-live/persistence';
import { admission, baseline, codec, commit, identity, MemoryStore, update } from '../helpers/canvas-live';

describe('canvas live restart recovery', () => {
  it('should restore encoded state plus only the journal suffix including deletes and epoch', async () => {
    const store = new MemoryStore();
    await store.open(identity, baseline, admission.schemaEpoch);
    const doc = codec.create();
    await store.commit(identity, 0, commit(update(doc, t => t.insert(0, 'abc'))));
    const checkpoint = sealCheckpoint({ checkpointId: 'cp-a', documentId: identity.documentId,
      encodedState: codec.encode(doc), stateVector: codec.vector(doc), journalWatermark: 1,
      schemaEpoch: '1', createdAt: '2026-10-29T00:00:00Z', createdBy: 'host' });
    await store.checkpoint(identity, 1, checkpoint);
    await store.commit(identity, 1, commit(update(doc, t => t.delete(1, 1)), 'delete'));
    const restored = restoreDocument(await store.load(identity), codec);
    expect(restored.getText('field:body').toString()).toBe('ac');
    expect(codec.encode(restored)).toBe(codec.encode(doc));
    expect(codec.vector(restored)).toBe(codec.vector(doc));
    expect(Y.decodeUpdate(Buffer.from(codec.encode(restored), 'base64')).ds)
      .toEqual(Y.decodeUpdate(Buffer.from(codec.encode(doc), 'base64')).ds);
    expect(store.state.schemaEpoch).toBe('1');
    codec.apply(restored, store.state.journal[1].encodedUpdate!);
    expect(codec.encode(restored)).toBe(codec.encode(doc));
  });

  it('should refuse a changed watermark rather than silently omit an update', async () => {
    const store = new MemoryStore();
    await store.open(identity, baseline, '1');
    const doc = codec.create();
    await store.commit(identity, 0, commit(update(doc, t => t.insert(0, 'a'))));
    store.state.checkpoint = sealCheckpoint({ checkpointId: 'cp', documentId: identity.documentId,
      encodedState: codec.encode(doc), stateVector: codec.vector(doc), journalWatermark: 1,
      schemaEpoch: '1', createdAt: 'now', createdBy: 'host' });
    await store.commit(identity, 1, commit(update(doc, t => t.insert(1, 'b')), 'next'));
    store.state.checkpoint.journalWatermark = 2;
    expect(() => restoreDocument(store.state, codec)).toThrow('checkpoint-integrity');
    store.state.checkpoint = null;
    store.state.journal.shift();
    expect(() => restoreDocument(store.state, codec)).toThrow('journal-gap');
  });
});

function fixture() {
  const principal = { tenantId: 't', workspaceId: 'w', actor: { actorId: 'b', kind: 'human' as const, displayLabel: 'B', color: '#123456' } };
  const facts = { documentId: 'canvas:a', sessionId: 's', profileId: 'current@1', schemaEpoch: '2', fields: ['description'] };
  const original = new Uint8Array([0, 255, 13, 10, 127]);
  const drafts = new Map<string, PreservedDraft>();
  const pending = new Map<string, string>();
  const migrate = vi.fn(async (bytes: Uint8Array) => new Uint8Array([...bytes, 42]));
  const ports = {
    pending: async (key: string, id?: string | null, expected?: string) => { if (id === null && pending.get(key) === expected) pending.delete(key); else if (id) pending.set(key, id); return pending.get(key) ?? null; },
    update: async (key: string, change: (old?: PreservedDraft) => PreservedDraft) => {
      const value = change(drafts.get(key)); drafts.set(key, structuredClone(value)); return structuredClone(value);
    }, migrate,
  };
  return { principal, facts, original, migrate, drafts, pending, ports, recovery: new DraftRecovery(ports) };
}
describe('canvas incompatible draft recovery', () => {
  it.each(['client-upgrade', 'draft-migration'] as const)('should require explicit actor/draft acknowledgement for %s', async (branch) => {
    const f = fixture(); const before = structuredClone(f.facts);
    const preserved = await f.recovery.preserve(f.principal, f.facts.documentId, 'draft-b', { bytes: f.original, profileId: 'old@1', schemaEpoch: '1' });
    expect(preserved.bytes).toEqual(f.original);
    const prepared = await f.recovery.prepare(f.principal, f.facts, 'draft-b', branch);
    expect(prepared.bytes).toEqual(f.original);
    expect(prepared.prepared?.bytes).toEqual(branch === 'draft-migration' ? new Uint8Array([...f.original, 42]) : f.original);
    await expect(f.recovery.requireAcknowledged(f.principal, f.facts, 'draft-b')).rejects.toMatchObject({ code: 'incompatible-schema' });
    await expect(f.recovery.requirePendingAcknowledged(f.principal, f.facts)).rejects.toMatchObject({ code: 'incompatible-schema' });
    await f.recovery.acknowledge(f.principal, f.facts, 'draft-b');
    await expect(new DraftRecovery(f.ports).requireAcknowledged(f.principal, f.facts, 'draft-b')).resolves.toBeUndefined();
    await expect(new DraftRecovery(f.ports).requirePendingAcknowledged(f.principal, f.facts)).resolves.toBeUndefined();
    expect(f.facts).toEqual(before);
    expect(f.migrate).toHaveBeenCalledTimes(branch === 'draft-migration' ? 1 : 0);
    await expect(f.recovery.requireAcknowledged({ ...f.principal, tenantId: 'other' }, f.facts, 'draft-b')).rejects.toMatchObject({ code: 'incompatible-schema' });
    await expect(f.recovery.requireAcknowledged({ ...f.principal, actor: { ...f.principal.actor, actorId: 'other' } }, f.facts, 'draft-b')).rejects.toMatchObject({ code: 'incompatible-schema' });
    await expect(f.recovery.requireAcknowledged(f.principal, { ...f.facts, schemaEpoch: '3' }, 'draft-b')).rejects.toMatchObject({ code: 'incompatible-schema' });
  });
  it('should preserve bytes across repeated incompatible retries without overwriting or acknowledging them', async () => {
    const f = fixture();
    await f.recovery.preserve(f.principal, f.facts.documentId, 'draft-b', { bytes: f.original, profileId: 'old@1', schemaEpoch: '1' });
    await expect(f.recovery.preserve(f.principal, f.facts.documentId, 'draft-b', { bytes: new Uint8Array([1]), profileId: 'old@1', schemaEpoch: '1' })).rejects.toMatchObject({ code: 'draft-id-reuse' });
    const retry = await f.recovery.preserve(f.principal, f.facts.documentId, 'draft-b', { bytes: f.original, profileId: 'old@1', schemaEpoch: '1' });
    expect(retry.bytes).toEqual(f.original);
    await expect(f.recovery.acknowledge(f.principal, f.facts, 'draft-b')).rejects.toMatchObject({ code: 'incompatible-schema' });
  });
  it('should retain distinct immutable captures and recover the latest refused bytes', async () => {
    const f = fixture();
    await f.recovery.preserve(f.principal, f.facts.documentId, 'first', { bytes: f.original, profileId: 'old@1', schemaEpoch: '1' });
    const latest = new Uint8Array([9, 8, 7]);
    await f.recovery.preserve(f.principal, f.facts.documentId, 'second', { bytes: latest, profileId: 'old@1', schemaEpoch: '1' });
    const migrated = await f.recovery.prepare(f.principal, f.facts, 'second', 'draft-migration');
    expect(migrated.bytes).toEqual(latest); expect(migrated.prepared?.bytes).toEqual(new Uint8Array([...latest, 42]));
    expect([...f.drafts.values()].map((draft) => draft.bytes)).toContainEqual(f.original);
    await f.recovery.acknowledge(f.principal, f.facts, 'second');
    await f.recovery.consumePendingAcknowledged(f.principal, f.facts);
    expect(f.pending.size).toBe(0); expect(f.drafts.size).toBe(2);
  });
  it('should discard only the explicitly named actor draft and retain a newer pending capture', async () => {
    const f = fixture();
    for (const id of ['first', 'second']) await f.recovery.preserve(f.principal, f.facts.documentId, id, { bytes: f.original, profileId: 'old@1', schemaEpoch: '1' });
    await expect(f.recovery.discard({ ...f.principal, tenantId: 'other' }, f.facts, 'second')).rejects.toMatchObject({ code: 'incompatible-schema' });
    await f.recovery.discard(f.principal, f.facts, 'first');
    expect([...f.pending.values()]).toEqual(['second']);
    await expect(f.recovery.requirePendingAcknowledged(f.principal, f.facts)).rejects.toMatchObject({ code: 'incompatible-schema' });
    await f.recovery.discard(f.principal, f.facts, 'second');
    expect(f.pending.size).toBe(0); expect([...f.drafts.values()].every((draft) => draft.bytes.length === 0)).toBe(true);
  });
});
