// Decode ordering guarantees (r3 L3): stale window results are ignored, finals
// resolve independently per utterance in any arrival order, silent windows stay quiet.
// Every push is sized against the 0.5 s decode cadence so each window decode is explicit.
import { describe, expect, it } from 'vitest';
import { LocalSttSession, type LocalSttEvent } from '../src/node/local-stt.js';
import type { WorkerPort } from '../src/node/worker-port.js';
import { selectLocalSttProfile } from '../src/node/profiles.js';
import type { SttTranscription } from '../src/node/engine-port.js';
import { FakePort, flush, SEG, silence, tone } from './helpers.js';

const tiny = () => selectLocalSttProfile('local-tiny');

function session(port: WorkerPort, events: LocalSttEvent[] = []) {
  return new LocalSttSession({ profile: tiny(), port, emit: (event) => events.push(event) });
}

const partials = (events: LocalSttEvent[]) => events.filter((event) => event.type === 'partial');
const finals = (events: LocalSttEvent[]) => events.filter((event) => event.type === 'final');
const textOf = (events: LocalSttEvent[]) => events.map((event) => (event.type === 'partial' || event.type === 'final' ? event.text : ''));

describe('ordering', () => {
  it('should ignore stale window results that resolve after the endpoint', async () => {
    const events: LocalSttEvent[] = [];
    let resolveOld!: (value: SttTranscription) => void;
    const old = new Promise<SttTranscription>((resolve) => { resolveOld = resolve; });
    let calls = 0;
    const base = new FakePort([{ segments: [SEG('second')] }]);
    const gate: WorkerPort = {
      get terminated() { return base.terminated; },
      transcribe(window, options) {
        calls += 1;
        if (calls === 1) return old;
        return base.transcribe(window, options);
      },
      terminate() { base.terminate(); },
    };
    const session_ = session(gate, events);
    session_.pushFrames(tone(0.5));
    await flush();
    // While the first window is still in flight, further cadence ticks dispatch
    // nothing; the endpoint takes priority and resolves first.
    session_.pushFrames(silence(0.6));
    await flush(40);
    expect(calls).toBe(2);
    expect(textOf(finals(events))).toEqual(['second']);
    // Stale window resolves late, after its utterance closed: ignored.
    resolveOld({ segments: [SEG('first')] });
    await flush();
    expect(partials(events)).toHaveLength(0);
    expect(finals(events)).toHaveLength(1);
  });

  it('should resolve finals independently per utterance in any arrival order', async () => {
    const events: LocalSttEvent[] = [];
    const releases: Array<(value: SttTranscription) => void> = [];
    const gate: WorkerPort = {
      terminated: false,
      transcribe() {
        return new Promise<SttTranscription>((resolve) => releases.push(resolve));
      },
      terminate() {},
    };
    const session_ = session(gate, events);
    session_.pushFrames(tone(0.6));
    await flush();
    session_.pushFrames(silence(0.6));
    await flush();
    // u1 window and endpoint decodes are pending; speech continues into u2
    // immediately. u2 cadence ticks dispatch nothing while u1's window is in
    // flight; u2's endpoint still takes priority.
    session_.pushFrames(tone(0.6));
    await flush();
    session_.pushFrames(silence(0.6));
    await flush(40);
    // releases: [u1 window, u1 final, u2 final] — windows coalesced, finals prioritized.
    expect(releases).toHaveLength(3);
    // Out-of-order arrival: u2 final first, then u1 — each exactly once.
    releases[2]({ segments: [SEG('two')] });
    await flush();
    releases[1]({ segments: [SEG('one')] });
    await flush();
    const done = finals(events);
    expect(done).toHaveLength(2);
    expect(done[0]).toMatchObject({ utteranceId: 'u2', text: 'two' });
    expect(done[1]).toMatchObject({ utteranceId: 'u1', text: 'one' });
  });

  it('should emit no partials for windows without usable recognition', async () => {
    const events: LocalSttEvent[] = [];
    const port = new FakePort([
      { segments: [] },
      { segments: [{ text: 'x', noSpeechProb: 0.99 }] },
      { segments: [SEG('audible')] },
      { segments: [SEG('audible')] },
    ]);
    const session_ = session(port, events);
    session_.pushFrames(tone(0.5));
    await flush();
    session_.pushFrames(tone(0.5));
    await flush();
    expect(partials(events)).toHaveLength(0);
    session_.pushFrames(tone(0.5));
    await flush();
    expect(textOf(partials(events))).toEqual(['audible']);
    session_.pushFrames(silence(0.7));
    await flush(40);
    expect(finals(events)).toHaveLength(1);
  });
});
