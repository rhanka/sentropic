// Capture/control wiring tests (r3 L4): a key press toggles the mic, gated
// frames flow into the L3 session, toggle-off starves it, stop closes all.
// Control stays independent of VAD: silent frames still cross the mic gate.
import { describe, expect, it } from 'vitest';
import { CaptureSession } from '../src/node/capture.js';
import { LocalSttSession, type LocalSttEvent } from '../src/node/local-stt.js';
import { TerminalController, type TerminalControlEvent } from '../src/node/terminal-control.js';
import { FakeDevice } from './fixtures/fake-device.js';
import { FakePort, flush, SEG, silence, tone } from './helpers.js';
import { selectLocalSttProfile } from '../src/node/profiles.js';

const tiny = () => selectLocalSttProfile('local-tiny');
const opts = { sampleRateHz: 16000, channels: 1 as const, frameMs: 50, energyThresholdDb: -45 };

interface Harness {
  capture: CaptureSession;
  session: LocalSttSession;
  events: LocalSttEvent[];
  controlEvents: TerminalControlEvent[];
  press: (key: string) => void;
}

async function harness(deviceScripts: Float32Array[][], initialKeys: string[] = []): Promise<Harness> {
  const events: LocalSttEvent[] = [];
  const controlEvents: TerminalControlEvent[] = [];
  const device = new FakeDevice(deviceScripts);
  const capture = new CaptureSession(device, { ...opts, maxMailboxFrames: 32 });
  const port = new FakePort([
    { segments: [SEG('hello')] },
    { segments: [SEG('hello world')] },
  ]);
  const session = new LocalSttSession({ profile: tiny(), port, emit: (event) => events.push(event) });
  const controller = new TerminalController((event) => {
    controlEvents.push(event);
    if (event.kind === 'mic-toggle') capture.setMicOn(!capture.diagnostics().micOn);
    if (event.kind === 'stop') void capture.close().then(() => session.close());
  });
  // Owned test key source: synchronous delivery like a TTY data event.
  const listeners = new Set<(chunk: Buffer) => void>();
  controller.attach({
    on: (_event: 'data', listener: (chunk: Buffer) => void) => {
      listeners.add(listener);
    },
    off: (_event: 'data', listener: (chunk: Buffer) => void) => {
      listeners.delete(listener);
    },
  });
  // Press before opening: the pump starts consuming during open()'s awaits,
  // so mic state must precede the first frame.
  const api = {
    capture,
    session,
    events,
    controlEvents,
    press: (key: string) => {
      for (const listener of listeners) listener(Buffer.from(key, 'utf8'));
    },
  };
  for (const key of initialKeys) api.press(key);
  await capture.open('fake-default');
  return api;
}

async function pushDrained(h: Harness): Promise<void> {
  for (const frame of h.capture.drain()) h.session.pushFrames(frame.pcm);
  await flush(10);
}

describe('capture/control wiring', () => {
  it('should flow gated frames into the session after toggle-on', async () => {
    const h = await harness([[tone(1.2), silence(0.7)]], ['m']);
    await flush(10);
    await pushDrained(h);
    await flush(40);
    const finals = h.events.filter((event) => event.type === 'final');
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ utteranceId: 'u1', text: 'hello world' });
    expect(h.controlEvents).toEqual([{ kind: 'mic-toggle' }]);
    await h.capture.close();
    h.session.close();
  });

  it('should starve the session while the mic stays off', async () => {
    const h = await harness([[tone(0.6)]], ['m', 'm']);
    await flush(10);
    await pushDrained(h);
    await flush(40);
    // Ended mic-off: nothing forwarded, the session never opened an utterance.
    expect(h.events).toEqual([]);
    expect(h.capture.diagnostics().micOn).toBe(false);
    await h.capture.close();
    h.session.close();
  });

  it('should close everything on the stop key', async () => {
    const h = await harness([[tone(0.6)]]);
    h.press('s');
    await flush(10);
    expect(h.controlEvents).toEqual([{ kind: 'stop' }]);
    expect(h.capture.diagnostics().open).toBe(false);
    expect(h.session.diagnostics().closed).toBe(true);
  });

  it('should forward silent frames while VAD stays shut', async () => {
    const h = await harness([[silence(0.5)]], ['m']);
    await flush(10);
    const frames = h.capture.drain();
    // The mic gate is independent of VAD: silence crosses, marked not-speech.
    expect(frames).toHaveLength(1);
    expect(frames[0].speech).toBe(false);
    for (const frame of frames) h.session.pushFrames(frame.pcm);
    await flush(40);
    expect(h.events).toEqual([]);
    await h.capture.close();
    h.session.close();
  });
});
