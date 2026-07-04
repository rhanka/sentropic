import { describe, expect, it } from 'vitest';

import {
  createHydrationGenerations,
  createNdjsonSplitter,
  normalizeHydratedMessage,
  parseSessionHistoryLine,
  shouldFlushHistoryStage,
  upsertSequencedMessage,
} from '../src/state/chatSessionHydration';

const enc = (s: string) => new TextEncoder().encode(s);

describe('chatSessionHydration (gold shell S1b)', () => {
  it('splits NDJSON lines across chunk boundaries and flushes the trailing partial line', () => {
    const splitter = createNdjsonSplitter();
    expect(splitter.push(enc('{"a":1}\n{"b"'))).toEqual(['{"a":1}']);
    expect(splitter.push(enc(':2}\n{"c":3}'))).toEqual(['{"b":2}']);
    expect(splitter.flush()).toBe('{"c":3}');
  });

  it('flush returns null when nothing but whitespace remains', () => {
    const splitter = createNdjsonSplitter();
    expect(splitter.push(enc('{"a":1}\n  '))).toEqual(['{"a":1}']);
    expect(splitter.flush()).toBeNull();
  });

  it('parses meta and timeline lines, returns null on blank, throws on malformed JSON', () => {
    expect(
      parseSessionHistoryLine('{"type":"session_meta","sessionId":"s1","title":"T"}'),
    ).toMatchObject({ type: 'session_meta', sessionId: 's1' });
    expect(
      parseSessionHistoryLine(
        '{"type":"timeline_item","item":{"kind":"message","key":"k","message":{"id":"m1"}}}',
      ),
    ).toMatchObject({ type: 'timeline_item' });
    expect(parseSessionHistoryLine('   ')).toBeNull();
    expect(() => parseSessionHistoryLine('{oops')).toThrow();
  });

  it('invalidates older hydration generations on begin() and invalidate()', () => {
    const generations = createHydrationGenerations();
    const first = generations.begin();
    expect(first.isCurrent()).toBe(true);
    const second = generations.begin();
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    generations.invalidate();
    expect(second.isCurrent()).toBe(false);
  });

  it('flushes only when a non-empty staged block outgrows a valid viewport', () => {
    expect(
      shouldFlushHistoryStage({ stagedCount: 0, stagedHeight: 900, viewportHeight: 600 }),
    ).toBe(false);
    expect(
      shouldFlushHistoryStage({ stagedCount: 3, stagedHeight: 500, viewportHeight: 600 }),
    ).toBe(false);
    expect(
      shouldFlushHistoryStage({ stagedCount: 3, stagedHeight: 700, viewportHeight: 600 }),
    ).toBe(true);
    expect(
      shouldFlushHistoryStage({ stagedCount: 3, stagedHeight: 700, viewportHeight: 0 }),
    ).toBe(false);
    expect(
      shouldFlushHistoryStage({ stagedCount: 3, stagedHeight: 700, viewportHeight: Number.NaN }),
    ).toBe(false);
  });

  it('normalizes hydrated messages: stream id defaults to id, content implies completed', () => {
    expect(normalizeHydratedMessage({ id: 'm1', content: 'hello' })).toMatchObject({
      _streamId: 'm1',
      _localStatus: 'completed',
    });
    expect(normalizeHydratedMessage({ id: 'm2', content: null })).toMatchObject({
      _streamId: 'm2',
      _localStatus: undefined,
    });
    expect(
      normalizeHydratedMessage({ id: 'm3', content: 'x', _streamId: 's', _localStatus: 'pending' }),
    ).toMatchObject({ _streamId: 's', _localStatus: 'pending' });
  });

  it('merges an existing message in place and keeps the list otherwise untouched', () => {
    const list = [
      { id: 'a', sequence: 1, content: 'old' },
      { id: 'b', sequence: 2 },
    ];
    const next = upsertSequencedMessage(list, { id: 'a', sequence: 1, content: 'new' });
    expect(next.map((m) => m.id)).toEqual(['a', 'b']);
    expect(next[0]).toMatchObject({ content: 'new' });
  });

  it('inserts new messages keeping ascending sequence order (streamed end-first)', () => {
    let list: { id: string; sequence?: number }[] = [];
    list = upsertSequencedMessage(list, { id: 'm9', sequence: 9 });
    list = upsertSequencedMessage(list, { id: 'm7', sequence: 7 });
    list = upsertSequencedMessage(list, { id: 'm8', sequence: 8 });
    list = upsertSequencedMessage(list, { id: 'm10', sequence: 10 });
    expect(list.map((m) => m.sequence)).toEqual([7, 8, 9, 10]);
  });

  it('treats a missing sequence as 0 (inserted before higher sequences)', () => {
    const list = [{ id: 'a', sequence: 5 }];
    const next = upsertSequencedMessage(list, { id: 'z' });
    expect(next.map((m) => m.id)).toEqual(['z', 'a']);
  });
});
