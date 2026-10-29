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
    const input = commit(update(doc, t => t.insert(0, 'a')));
    input.formattingIntents = [intent('agent-intent')];
    await session.accept(input, async entry => {
      const saved = await store.load(identity);
      expect(saved.journal).toEqual([entry]);
      expect(entry.receipt?.affectedItems).toEqual(input.receipt?.affectedItems);
      expect(entry.formattingIntents).toEqual(input.formattingIntents);
    });
    const human = commit(null, 'same-value');
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
});
