// Window reconciliation tests (r3 L3): overlap dedupe, stable-prefix policy,
// revisioned replaces. Every push is sized against the 0.5 s decode cadence
// so each window decode is explicit.
import { describe, expect, it } from 'vitest';
import { LocalSttSession, type LocalSttEvent } from '../src/node/local-stt.js';
import type { WorkerPort } from '../src/node/worker-port.js';
import { selectLocalSttProfile } from '../src/node/profiles.js';
import { FakePort, flush, SEG, silence, tone } from './helpers.js';

const tiny = () => selectLocalSttProfile('local-tiny');

function session(port: WorkerPort, events: LocalSttEvent[] = []) {
  return new LocalSttSession({ profile: tiny(), port, emit: (event) => events.push(event) });
}

const partials = (events: LocalSttEvent[]) => events.filter((event) => event.type === 'partial');
const finals = (events: LocalSttEvent[]) => events.filter((event) => event.type === 'final');
const textOf = (events: LocalSttEvent[]) => events.map((event) => (event.type === 'partial' || event.type === 'final' ? event.text : ''));

describe('long utterances', () => {
  it('should stitch committed text across windows beyond windowSec without duplication', async () => {
    // 8 s utterance at 4 s tiny window: every window decode extends the hypothesis
    // word by word; each emission commits with its sample offset and the next
    // window restarts at committedEnd - overlapSec.
    const words = Array.from({ length: 16 }, (_, index) => `w${index}`);
    const full = words.join(' ');
    const script = words.map((_, index) => ({ segments: [SEG(words.slice(0, index + 1).join(' '))] }));
    script.push({ segments: [SEG(full)] });
    const events: LocalSttEvent[] = [];
    const port = new FakePort(script);
    const session_ = session(port, events);
    for (let push = 0; push < 16; push++) {
      session_.pushFrames(tone(0.5));
      await flush();
    }
    session_.pushFrames(silence(0.7));
    await flush(40);
    const revs = partials(events);
    expect(revs.length).toBeGreaterThanOrEqual(2);
    // Every partial extends the previous one; the committed head is never rewritten.
    const texts = textOf(revs);
    for (let index = 1; index < texts.length; index++) {
      expect(texts[index].startsWith(texts[index - 1])).toBe(true);
      expect(revs[index]).toMatchObject({ revision: index + 1, replaces: { start: 0, end: texts[index - 1].length } });
    }
    expect(texts[texts.length - 1]).toBe(full);
    const done = finals(events);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ utteranceId: 'u1', text: full });
    // Each committed word appears exactly once in the final — no overlap duplication.
    for (const word of words) {
      expect(done[0].type === 'final' && done[0].text.split(' ').filter((part) => part === word)).toHaveLength(1);
    }
    session_.close();
  });
});

describe('overlap dedupe', () => {
  it('should emit full-hypothesis revisions that replace, never duplicated overlap', async () => {
    const events: LocalSttEvent[] = [];
    const port = new FakePort([
      { segments: [SEG('bonjour')] },
      { segments: [SEG('bonjour le')] },
      { segments: [SEG('bonjour le monde')] },
      { segments: [SEG('bonjour le monde')] },
    ]);
    const session_ = session(port, events);
    session_.pushFrames(tone(0.5));
    await flush();
    session_.pushFrames(tone(0.5));
    await flush();
    session_.pushFrames(tone(0.2));
    await flush();
    session_.pushFrames(silence(0.7));
    await flush(40);
    const revs = partials(events);
    // The silence push fires a window decode and the endpoint together; the in-flight
    // window decode is superseded by the authoritative endpoint decode — never duplicated.
    expect(textOf(revs)).toEqual(['bonjour', 'bonjour le']);
    expect(revs[0]).toMatchObject({ revision: 1, replaces: { start: 0, end: 0 } });
    expect(revs[1]).toMatchObject({ revision: 2, replaces: { start: 0, end: 7 } });
    const done = finals(events);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ utteranceId: 'u1', text: 'bonjour le monde' });
    // The committed overlap appears exactly once — never appended twice.
    expect(done[0].type === 'final' && (done[0].text.match(/bonjour/g) ?? []).length).toBe(1);
  });

  it('should hold transient wobble below the stable prefix and resume on extension', async () => {
    const events: LocalSttEvent[] = [];
    const port = new FakePort([
      { segments: [SEG('hello world')] },
      { segments: [SEG('hello world')] },
      { segments: [SEG('HELLO')] },
      { segments: [SEG('hello world again')] },
      { segments: [SEG('hello world again')] },
    ]);
    const session_ = session(port, events);
    session_.pushFrames(tone(0.5));
    await flush();
    session_.pushFrames(tone(0.5));
    await flush();
    session_.pushFrames(tone(0.5));
    await flush();
    session_.pushFrames(tone(0.5));
    await flush();
    // rev1 'hello world'; identical rev2 skipped and stabilizes; 'HELLO' held; extension emitted.
    expect(textOf(partials(events))).toEqual(['hello world', 'hello world again']);
    const revs = partials(events);
    expect(revs[1]).toMatchObject({ revision: 2, replaces: { start: 0, end: 11 } });
    session_.pushFrames(silence(0.7));
    await flush(40);
    expect(finals(events)).toHaveLength(1);
  });
});


