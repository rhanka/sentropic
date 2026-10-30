import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  admissionRecord, contextFor, docOf, deltaFrom, framesOf, hostFixture, registryFixture,
} from '../helpers/canvas-live-h3';

describe('canvas live awareness registry delivery (DS 13 F2)', () => {
  it('should register actors, deliver registry updates, and clear awareness on leave and revocation', async () => {
    const actorA = admissionRecord(['description', 'notes']);
    const actorB: typeof actorA = {
      ...actorA,
      actor: { actorId: 'human-b', kind: 'human', displayLabel: 'B', color: '#654321' },
    };
    const { registry, awareness } = registryFixture();
    const delivered: { actors: { actorId: string; awarenessClientId: number }[] }[] = [];
    const first = registry.open(actorA, 'description');
    const unsubscribe = registry.subscribeActors(actorA, (actors) => {
      delivered.push({ actors: actors.map((a) => ({ actorId: a.actor.actorId, awarenessClientId: a.awarenessClientId })) });
    });
    expect(delivered.at(-1)?.actors.map((a) => a.actorId)).toEqual(['human-a']);
    const second = registry.open(actorB, 'notes');
    expect(delivered.at(-1)?.actors.map((a) => a.actorId)).toEqual(['human-a', 'human-b']);
    const bClientId = delivered.at(-1)?.actors.find((a) => a.actorId === 'human-b')?.awarenessClientId;
    registry.revoke(actorB);
    expect(delivered.at(-1)?.actors.map((a) => a.actorId)).toEqual(['human-a']);
    await first.dispose();
    await second.dispose();
    expect(delivered.at(-1)?.actors).toEqual([]);
    expect(awareness.remove).toHaveBeenCalledWith(bClientId);
    unsubscribe();
    expect(() => registry.resolveBinding(actorB, second.identity)).toThrow('revoked');
  });
});

describe('canvas live composition replacement semantics (DS 13 F6, api level)', () => {
  const replaceRange = (client: Y.Doc) => {
    client.transact(() => {
      const text = client.getText('field:notes');
      text.delete(2, 3);
      text.insert(2, 'XY');
    });
  };
  const concurrentEdit = (client: Y.Doc) => {
    client.transact(() => {
      const text = client.getText('field:notes');
      text.delete(0, 1);
      text.insert(5, 'Z');
    });
  };

  function seededSession() {
    const record = admissionRecord(['notes']);
    const { registry } = registryFixture();
    const handle = registry.open(record, 'notes');
    const { host } = hostFixture({ record, registry });
    return { record, registry, handle, host };
  }

  it('should converge when a range replacement meets a concurrent insert and delete in either order', async () => {
    const sessions = [seededSession(), seededSession()];
    const baselines = sessions.map(({ record, registry }) => docOf(registry, record, 'notes'));
    baselines.forEach((doc) => doc.getText('field:notes').insert(0, 'abcdef'));
    const order: [(client: Y.Doc) => void, (client: Y.Doc) => void][] = [
      [replaceRange, concurrentEdit],
      [concurrentEdit, replaceRange],
    ];
    const finalTexts: string[] = [];
    for (const [index, session] of sessions.entries()) {
      const authoritative = docOf(session.registry, session.record, 'notes');
      const first = deltaFrom(authoritative, order[index][0]);
      const second = deltaFrom(authoritative, order[index][1]);
      expect((await session.host.handleUpdate(contextFor(session.record), session.handle.identity, framesOf(first))).applied).toBe(true);
      expect((await session.host.handleUpdate(contextFor(session.record), session.handle.identity, framesOf(second))).applied).toBe(true);
      finalTexts.push(authoritative.getText('field:notes').toString());
    }
    expect(finalTexts[0]).toBe(finalTexts[1]);
    expect(finalTexts[0]).toContain('XY');
    expect(finalTexts[0]).toContain('Z');
  });

  it('should keep authoritative state untouched when a composition is cancelled before commit', async () => {
    const { record, registry, handle, host } = seededSession();
    const authoritative = docOf(registry, record, 'notes');
    authoritative.getText('field:notes').insert(0, 'abcdef');
    const vectorBefore = Y.encodeStateVector(authoritative);
    deltaFrom(authoritative, replaceRange);
    expect(authoritative.getText('field:notes').toString()).toBe('abcdef');
    expect(Buffer.from(Y.encodeStateVector(authoritative)).equals(Buffer.from(vectorBefore))).toBe(true);
    await handle.dispose();
  });

  it('should commit a composition replacement and converge on reconnect replay', async () => {
    const { record, registry, handle, host } = seededSession();
    const authoritative = docOf(registry, record, 'notes');
    authoritative.getText('field:notes').insert(0, 'abcdef');
    const committed = deltaFrom(authoritative, replaceRange);
    expect((await host.handleUpdate(contextFor(record), handle.identity, framesOf(committed))).applied).toBe(true);
    expect(authoritative.getText('field:notes').toString()).toContain('XY');
    const replay = await host.handleUpdate(contextFor(record), handle.identity, framesOf(committed));
    expect(replay.applied).toBe(true);
    expect(authoritative.getText('field:notes').toString()).toBe('abXYf');
    await handle.dispose();
  });
});
