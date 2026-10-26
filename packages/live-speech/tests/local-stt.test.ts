// Local STT session tests (r3 L3): one final, teardown without
// starvation, worker isolation, no audio in events.
import { describe, expect, it } from 'vitest';
import { LocalSttSession, type LocalSttEvent } from '../src/node/local-stt.js';
import { NodeWorkerClient, SessionClosedError, type WorkerPort } from '../src/node/worker-port.js';
import type { SttTranscription } from '../src/node/engine-port.js';
import { selectLocalSttProfile } from '../src/node/profiles.js';
import { assertNoAudioPayload, concat, fakeClientOptions, FakePort, flush, SEG, silence, tone } from './helpers.js';

const tiny = () => selectLocalSttProfile('local-tiny');

function session(port: WorkerPort, events: LocalSttEvent[] = []) {
  return new LocalSttSession({ profile: tiny(), port, emit: (event) => events.push(event) });
}

describe('one final', () => {
  it('should emit exactly one final per utterance and ignore late duplicates', async () => {
    const events: LocalSttEvent[] = [];
    // call 1 (window) stays pending; call 2 (endpoint) resolves first.
    let resolveFirst!: (value: SttTranscription) => void;
    const port = new FakePort([{ segments: [SEG('hello world')] }]);
    const first = new Promise<SttTranscription>((resolve) => { resolveFirst = resolve; });
    let calls = 0;
    const gate: WorkerPort = {
      get terminated() { return port.terminated; },
      transcribe(window, options) {
        calls += 1;
        if (calls === 1) return first;
        return port.transcribe(window, options);
      },
      terminate() { port.terminate(); },
    };
    const session_ = session(gate, events);
    session_.pushFrames(tone(0.6));
    await flush();
    session_.pushFrames(silence(0.6));
    await flush(40);
    const finals = events.filter((event) => event.type === 'final');
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ utteranceId: 'u1', text: 'hello world' });
    // Late duplicate for the same closed utterance is ignored.
    resolveFirst({ segments: [SEG('hello')] });
    await flush();
    session_.pushFrames(silence(1));
    await flush();
    expect(events.filter((event) => event.type === 'final')).toHaveLength(1);
    expect(port.calls).toHaveLength(2);
  });

  it('should never synthesize a final from silence or unusable recognition', async () => {
    const events: LocalSttEvent[] = [];
    const port = new FakePort([{ segments: [{ text: '   ', noSpeechProb: 0.95 }] }]);
    const session_ = session(port, events);
    session_.pushFrames(tone(0.6));
    await flush();
    session_.pushFrames(silence(0.7));
    await flush(40);
    expect(events.filter((event) => event.type === 'final')).toHaveLength(0);
  });

  it('should report worker errors and stay usable for the next utterance', async () => {
    const events: LocalSttEvent[] = [];
    const port = new FakePort([{ error: 'boom' }, { segments: [SEG('again')] }, { segments: [SEG('again')] }]);
    const session_ = session(port, events);
    session_.pushFrames(tone(0.6));
    await flush(40);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
    session_.pushFrames(silence(0.7));
    await flush(40);
    session_.pushFrames(tone(0.6));
    await flush();
    session_.pushFrames(silence(0.7));
    await flush(40);
    const finals = events.filter((event) => event.type === 'final');
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ utteranceId: 'u2' });
  });
});

describe('teardown without starvation', () => {
  it('should terminate the worker, settle and release everything on close', async () => {
    const events: LocalSttEvent[] = [];
    const port = new FakePort([{ hang: true }]);
    const session_ = session(port, events);
    session_.pushFrames(tone(0.6));
    await flush();
    expect(port.calls).toHaveLength(1);
    session_.close();
    const diagnostics = session_.diagnostics();
    expect(diagnostics).toMatchObject({ closed: true, utteranceOpen: false, bufferedSamples: 0, retainedSamples: 0 });
    expect(port.terminateCount).toBe(1);
    expect(() => session_.pushFrames(tone(0.1))).toThrow(SessionClosedError);
    await flush();
    expect(events).toHaveLength(0);
    session_.close();
    expect(port.terminateCount).toBe(1);
  });

  it('should keep the event loop responsive while the worker is stuck, then stop it', async () => {
    const client = await NodeWorkerClient.create(fakeClientOptions([{ hang: true }]));
    const pending = client.transcribe(new Float32Array(160), { sampleRateHz: 16000 });
    let responsive = false;
    await new Promise((resolve) => setImmediate(resolve));
    responsive = true;
    expect(responsive).toBe(true);
    client.terminate();
    await expect(pending).rejects.toThrow(SessionClosedError);
    expect(client.terminated).toBe(true);
  });

  it('should reject session creation when the worker engine module is missing', async () => {
    const options = { ...fakeClientOptions([]), engineModule: '/nonexistent/fake-engine.mjs', timeoutMs: 5000 };
    await expect(NodeWorkerClient.create(options)).rejects.toThrow();
  });
});

describe('event hygiene', () => {
  it('should never carry audio payloads in events', async () => {
    const events: LocalSttEvent[] = [];
    const port = new FakePort([{ segments: [SEG('hello')] }, { segments: [SEG('hello world')] }, { segments: [SEG('hello world')] }]);
    const session_ = session(port, events);
    session_.pushFrames(concat(tone(0.5), tone(0.5), tone(0.2)));
    await flush();
    session_.pushFrames(silence(0.7));
    await flush(40);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) assertNoAudioPayload(event);
    session_.close();
  });
});
