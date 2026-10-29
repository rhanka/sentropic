import { describe, expect, it, vi } from 'vitest';
import { DurableSession } from '../../src/services/canvas-live/persistence';
import { admission, baseline, codec, commit, identity, intent, MemoryStore, registry, update } from '../helpers/canvas-live';

const setup = async () => {
  const store = new MemoryStore();
  const session = new DurableSession(store, codec, registry, admission, 'body');
  await session.open(baseline);
  return { store, session, doc: codec.create(), publish: vi.fn() };
};
describe('canvas live durable acceptance boundary', () => {
  it('should publish only after update receipt inverse and semantic intents are committed', async () => {
    const { store, session, doc } = await setup();
    const input = commit(update(doc, t => t.insert(0, 'a', { bold: true })));
    input.formattingIntents = [intent('agent-intent')];
    await session.accept(input, async entry => {
      const saved = await store.load(identity);
      expect(saved.journal).toEqual([entry]);
      expect(entry.receipt?.affectedItems).toEqual(input.receipt?.affectedItems);
      expect(entry.formattingIntents).toEqual(input.formattingIntents);
    });
    const before = codec.encode(doc);
    const human = commit(update(doc, t => t.format(0, 1, { bold: true })), 'same-value');
    expect(codec.encode(doc)).toBe(before);
    human.actorId = 'human-a';
    delete human.receipt;
    human.formattingIntents = [{ ...intent('human-intent'), actorId: 'human-a',
      source: { kind: 'human-transaction', transactionId: 'same-value' } }];
    const humanSession = new DurableSession(store, codec, registry,
      { ...admission, actor: { ...admission.actor, actorId: 'human-a', kind: 'human' } }, 'body');
    await humanSession.open(baseline);
    await humanSession.accept(human, async () => {});
    expect(store.state.journal.map(e => e.formattingIntents[0].intentId))
      .toEqual(['agent-intent', 'human-intent']);
    expect(store.state.journal.map(e => e.seq)).toEqual([1, 2]);
  });

  it.each(['before', 'after'] as const)('should rebuild committed state after a %s commit failure', async phase => {
    const { store, session, doc, publish } = await setup();
    store.fail = phase;
    await expect(session.accept(commit(update(doc, t => t.insert(0, 'rejected'))), publish)).rejects.toThrow('crash');
    expect(publish).not.toHaveBeenCalled();
    store.fail = null;
    const recovered = codec.create();
    codec.apply(recovered, (await session.snapshot()).encodedState);
    expect(recovered.getText('field:body').toString()).toBe(phase === 'before' ? '' : 'rejected');
    expect(store.state.journal).toHaveLength(phase === 'before' ? 0 : 1);
    if (phase === 'after') expect(store.state.journal[0].receipt?.status).toBe('applied');
    const next = update(recovered, t => t.insert(t.length, 'next'));
    await session.accept(commit(next, 'next'), publish);
    const result = codec.create();
    codec.apply(result, (await session.snapshot()).encodedState);
    expect(codec.encode(result)).toBe(codec.encode(recovered));
  });

  it('should refuse publication while recovery or current admission fails', async () => {
    const { store, session, doc, publish } = await setup();
    store.fail = 'before';
    await expect(session.accept(commit(update(doc, t => t.insert(0, 'x'))), publish)).rejects.toThrow();
    vi.spyOn(store, 'load').mockRejectedValueOnce(new Error('database-offline'));
    await expect(session.snapshot()).rejects.toThrow('database-offline');
    admission.closed = true;
    await expect(session.snapshot()).rejects.toThrow('scope-denied');
    admission.closed = false;
    expect(publish).not.toHaveBeenCalled();
  });

  it('should keep the editing baseline and admission epoch across reconnect', async () => {
    const { store, session, doc, publish } = await setup();
    await session.accept(commit(update(doc, t => t.insert(0, 'remote edits'))), publish);
    const next = new DurableSession(store, codec, registry, admission, 'body');
    await next.open({ ...baseline, headAtOpen: 'advanced-peer-head', baseHash: 'new-peer-hash' });
    expect(store.state.baseline).toEqual(baseline);
    expect(store.state.journal[0].sessionEpoch).toBe(admission.sessionEpoch);
  });

  it('should retain inverse read baseline and pending-publication dependencies without destructive compaction', async () => {
    const { liveRetention } = await import('../../src/services/canvas-live/journal');
    expect(Object.values(liveRetention).every(policy => policy === 'retain-all')).toBe(true);
    const { store, session, doc, publish } = await setup();
    const value = commit(update(doc, t => t.insert(0, 'retained')));
    value.records = [{ kind: 'freeze', returnId: 'pending', lineageId: baseline.lineageId,
      head: null, captureDigest: 'digest', excludedActorIds: [], pendingPublication: true }];
    await session.accept(value, publish);
    await session.checkpoint('checkpoint-a', '2026-10-29T00:00:00Z', 'host');
    expect(store.state.journal[0]).toMatchObject(value);
    expect(store.state.baseline).toEqual(baseline);
  });

  it('should reject an agent update without its terminal receipt before publication', async () => {
    const { store, session, doc, publish } = await setup();
    const value = commit(update(doc, t => t.insert(0, 'unreceipted')));
    delete value.receipt;
    await expect(session.accept(value, publish)).rejects.toThrow('agent-receipt-required');
    expect(store.state.head).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });
});
