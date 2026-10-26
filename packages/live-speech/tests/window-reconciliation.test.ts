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


