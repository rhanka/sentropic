// Voice-loop tests (r3 L6a): chunked preview, one submission, immediate
// clear, sensitive refusal, fence barge-in on both mic modes, epoch guard,
// key wiring, real-playback phases (synth/prespawn/playing), stop mapping,
// and the blocked §8.1 receipt guard.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CaptureSession } from '../src/node/capture.js';
import { TerminalController, type TerminalControlEvent } from '../src/node/terminal-control.js';
import { AplayPlayback, type PlaybackPort } from '../src/node/playback.js';
import type { TtsAudio, TtsEnginePort, TtsSynthesizeOptions } from '../src/node/tts-registry.js';
import {
  boundNarration,
  chunkNarration,
  VoiceLoop,
  VoiceLoopBusyError,
  VoiceLoopClosedError,
  VoiceLoopRefusedError,
  type BargeSource,
  type VoiceLoopEvent,
} from '../src/node/voice-loop.js';
import { FakeDevice } from './fixtures/fake-device.js';
import { assertNoAudioPayload, flush, silence, tone } from './helpers.js';

const CAPTURE_OPTS = { sampleRateHz: 16000, channels: 1 as const, frameMs: 50, energyThresholdDb: -45 };
const FAKE_APLAY = fileURLToPath(new URL('./fixtures/fake-aplay.mjs', import.meta.url));

function digestOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prior[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function stubWav(): Buffer {
  return Buffer.from([82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69]);
}

interface FakeTtsOptions {
  readonly engineId?: string;
  readonly hangSynth?: boolean;
  readonly synthError?: string;
}

class FakeTts implements TtsEnginePort {
  readonly engineId: string;
  readonly capabilities = { streaming: false as const, fileBased: false as const, pipedStdin: true as const, maxChars: 500 };
  calls: Array<{ text: string; voice?: string; speedWpm?: number }> = [];
  closeCount = 0;
  private releaseSynth: (() => void) | null = null;
  private readonly hang: boolean;
  private readonly failure: string | null;
  constructor(options: FakeTtsOptions = {}) {
    this.engineId = options.engineId ?? 'fake-tts/1';
    this.hang = options.hangSynth ?? false;
    this.failure = options.synthError ?? null;
  }
  async synthesize(text: string, options: TtsSynthesizeOptions = {}): Promise<TtsAudio> {
    this.calls.push({ text, voice: options.voice, speedWpm: options.speedWpm });
    if (this.failure !== null) throw new Error(this.failure);
    if (this.hang) await new Promise<void>((resolve) => (this.releaseSynth = resolve));
    return { wav: stubWav(), voice: options.voice ?? 'fake', chars: text.length };
  }
  release(): void {
    this.releaseSynth?.();
  }
  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

class FakePlayback implements PlaybackPort {
  calls: Buffer[] = [];
  cancelCalls = 0;
  closeCount = 0;
  private releasePlay: (() => void) | null = null;
  private failPlay: ((error: Error) => void) | null = null;
  constructor(
    private readonly hang: boolean = true,
    private readonly playError: Error | null = null,
  ) {}
  get playing(): boolean {
    return this.releasePlay !== null;
  }
  async play(wav: Buffer): Promise<void> {
    this.calls.push(wav);
    if (this.playError !== null) throw this.playError;
    if (!this.hang) return;
    await new Promise<void>((resolve, reject) => {
      this.releasePlay = resolve;
      this.failPlay = reject;
    });
    this.releasePlay = null;
    this.failPlay = null;
  }
  complete(): void {
    this.releasePlay?.();
  }
  cancel(): void {
    this.cancelCalls += 1;
    // The loop maps any play failure to cancelled while bargePending is set,
    // exactly like the real PlaybackCancelledError path.
    this.failPlay?.(new Error('cancelled by test double'));
  }
  close(): void {
    this.closeCount += 1;
  }
}

interface Harness {
  loop: VoiceLoop;
  tts: FakeTts;
  playback: FakePlayback;
  events: VoiceLoopEvent[];
}

function harness(
  tts?: FakeTts,
  playback?: FakePlayback,
  options: { micMode?: 'key' | 'open-mic'; sensitivePatterns?: readonly RegExp[] } = {},
): Harness {
  const events: VoiceLoopEvent[] = [];
  const fakeTts = tts ?? new FakeTts();
  const fakePlayback = playback ?? new FakePlayback();
  const loop = new VoiceLoop({
    tts: fakeTts,
    playback: fakePlayback,
    emit: (event) => events.push(event),
    micMode: options.micMode ?? 'key',
    sensitivePatterns: options.sensitivePatterns,
  });
  return { loop, tts: fakeTts, playback: fakePlayback, events };
}

function eventHygiene(h: Harness, secret?: string): void {
  assertNoAudioPayload(h.events);
  assertNoAudioPayload(h.loop.diagnostics());
  const text = JSON.stringify(h.events);
  expect(text).not.toMatch(/RIFF/);
  if (secret !== undefined) expect(text).not.toContain(secret);
}

describe('chunking', () => {
  it('should cut narration at a clause boundary and flag truncation', () => {
    expect(boundNarration('hello world', 480)).toEqual({ text: 'hello world', truncated: false });
    expect(boundNarration('  padded  ', 480)).toEqual({ text: 'padded', truncated: false });
    expect(boundNarration('', 480)).toEqual({ text: '', truncated: false });
    const long = 'First clause here. Second clause follows the first one today.';
    expect(boundNarration(long, 25)).toEqual({ text: 'First clause here.', truncated: true });
    expect(boundNarration('abcdefghijklmnopqrstuvwxyz', 10)).toEqual({ text: 'abcdefghij', truncated: true });
  });

  it('should split bounded text into clause chunks of at most 120 chars', () => {
    expect(chunkNarration('hello world', 120)).toEqual(['hello world']);
    expect(chunkNarration('', 120)).toEqual([]);
    const text = 'First clause here. Second clause follows the first one today.';
    expect(chunkNarration(text, 25)).toEqual(['First clause here.', 'Second clause follows the', 'first one today.']);
    for (const chunk of chunkNarration(`${'word '.repeat(50)}end.`, 120)) {
      expect(chunk.length).toBeLessThanOrEqual(120);
    }
  });
});

describe('voice loop', () => {
  it('should preview each chunk and play a narration end to end', async () => {
    const h = harness(new FakeTts(), new FakePlayback(false));
    const text =
      'Alpha clause states the case plainly. ' +
      'Beta clause follows with more detail here. ' +
      'Gamma clause closes the narration now.';
    const result = await h.loop.speak(text, { turnEpoch: 3, submitKey: 's1' });
    expect(result).toMatchObject({ status: 'played', chars: text.length, truncated: false });
    expect(result.chunks).toBeGreaterThan(1);
    expect(h.tts.calls).toHaveLength(result.chunks);
    expect(h.events[0]).toMatchObject({
      type: 'narration-start',
      chunks: result.chunks,
      truncated: false,
      turnEpoch: 3,
      submitKey: 's1',
    });
    expect(h.events[h.events.length - 1]).toMatchObject({
      type: 'narration-played',
      chunks: result.chunks,
      truncated: false,
    });
    expect(h.events.filter((event) => event.type === 'narration-chunk')).toHaveLength(result.chunks);
    expect(h.loop.diagnostics()).toMatchObject({ speaking: false, played: 1, cancelled: 0, epoch: 3 });
    eventHygiene(h);
  });

  it('should submit each chunk exactly once and stop resubmitting after a barge', async () => {
    const tts = new FakeTts();
    const h = harness(tts, new FakePlayback(true), { micMode: 'open-mic' });
    const pending = h.loop.speak('Chunk one here. Chunk two here. Chunk three here. Chunk four here.');
    await flush(10);
    const submitted = tts.calls.length;
    expect(submitted).toBeGreaterThanOrEqual(1);
    h.loop.barge('key');
    const result = await pending;
    expect(result.status).toBe('cancelled');
    // One submission per attempted chunk, no retry after the fence.
    expect(tts.calls.length).toBe(submitted);
    const retry = h.loop.speak('fresh narration');
    await flush(10);
    expect(tts.calls.filter((call) => call.text === 'fresh narration')).toHaveLength(1);
    h.loop.barge('key');
    await expect(retry).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('should clear the queue immediately on stop with no further chunks', async () => {
    const tts = new FakeTts({ hangSynth: true });
    const h = harness(tts, new FakePlayback(true), { micMode: 'open-mic' });
    const pending = h.loop.speak('Chunk one here. Chunk two here. Chunk three here.');
    await flush(10);
    const callsBefore = tts.calls.length;
    await h.loop.stop();
    expect(h.loop.diagnostics().speaking).toBe(false);
    tts.release();
    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    await flush(20);
    expect(tts.calls.length).toBe(callsBefore);
    expect(h.loop.diagnostics().closed).toBe(true);
    await expect(h.loop.speak('after close')).rejects.toThrow(VoiceLoopClosedError);
  });

  it('should refuse sensitive narration without playing or logging it', async () => {
    const secret = 'hunter2-secret';
    const h = harness(new FakeTts(), new FakePlayback(false), { micMode: 'key', sensitivePatterns: [/hunter\d+/] });
    await expect(h.loop.speak(`the password is ${secret}`)).rejects.toThrow(VoiceLoopRefusedError);
    expect(h.events).toEqual([]);
    expect(h.tts.calls).toEqual([]);
    eventHygiene(h, secret);
  });

  it('should flag truncation on long narration', async () => {
    const h = harness(new FakeTts(), new FakePlayback(false));
    const text = `${'A clause that runs on. '.repeat(30)}tail.`;
    const result = await h.loop.speak(text);
    expect(result).toMatchObject({ status: 'played', truncated: true });
    expect(result.chars).toBeLessThan(text.trim().length);
    const played = h.events[h.events.length - 1];
    expect(played).toMatchObject({ type: 'narration-played', truncated: true });
  });

  it('should carry the L2 turn epoch and refuse stale epochs', async () => {
    const h = harness(new FakeTts(), new FakePlayback(false));
    await h.loop.speak('epoch three', { turnEpoch: 3 });
    expect(h.loop.diagnostics().epoch).toBe(3);
    await expect(h.loop.speak('epoch two', { turnEpoch: 2 })).rejects.toThrow(VoiceLoopRefusedError);
    await expect(h.loop.speak('epoch two', { turnEpoch: 2 })).rejects.toThrow(/stale turn epoch/);
    expect(h.events.filter((event) => event.type === 'narration-start')).toHaveLength(1);
    await h.loop.speak('epoch five', { turnEpoch: 5 });
    expect(h.loop.diagnostics().epoch).toBe(5);
  });

  it('should refuse a late speak from the barged turn but accept the next one', async () => {
    const h = harness(new FakeTts(), new FakePlayback(false));
    await h.loop.speak('turn three', { turnEpoch: 3 });
    // L2 barges turn 4 before its late callback arrives: without the barge
    // raising the floor, speak(4) would be accepted (4 > 3).
    h.loop.barge('key', { turnEpoch: 4 });
    expect(h.loop.diagnostics().epoch).toBe(4);
    await expect(h.loop.speak('late turn four', { turnEpoch: 4 })).rejects.toThrow(/stale turn epoch/);
    await expect(h.loop.speak('untagged after epoch use')).rejects.toThrow(/untagged narration refused/);
    await expect(h.loop.speak('turn five', { turnEpoch: 5 })).resolves.toMatchObject({ status: 'played' });
    expect(h.loop.diagnostics().epoch).toBe(5);
  });

  it('should refuse key-shaped secrets by default without explicit policy', async () => {
    const secret = 'sk-ant-abcDEF1234567890';
    const h = harness(new FakeTts(), new FakePlayback(false));
    await expect(h.loop.speak(`the key is ${secret}`)).rejects.toThrow(VoiceLoopRefusedError);
    expect(h.events).toEqual([]);
    expect(h.tts.calls).toEqual([]);
    eventHygiene(h, secret);
  });

  it('should cancel playback within the barge call on open-mic VAD onset', async () => {
    const h = harness(new FakeTts(), new FakePlayback(true), { micMode: 'open-mic' });
    const pending = h.loop.speak('a long narration that keeps playing');
    await flush(10);
    expect(h.playback.calls).toHaveLength(1);
    h.loop.barge('vad');
    // Fence: the playback cancel fired synchronously inside barge(), with no
    // timers or awaits between the onset and the kill.
    expect(h.playback.cancelCalls).toBe(1);
    const result = await pending;
    expect(result.status).toBe('cancelled');
    expect(h.events.map((event) => event.type)).toEqual(['narration-start', 'narration-chunk', 'narration-cancelled']);
    expect(h.loop.diagnostics().cancelled).toBe(1);
    eventHygiene(h);
  });

  it('should gate VAD barge-in on mic state in key mode and never when muted', async () => {
    const h = harness(new FakeTts(), new FakePlayback(true), { micMode: 'key' });
    const pending = h.loop.speak('narration one');
    await flush(10);
    h.loop.barge('vad');
    expect(h.playback.cancelCalls).toBe(0);
    h.loop.setMicOn(true);
    h.loop.barge('vad');
    expect(h.playback.cancelCalls).toBe(1);
    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    const h2 = harness(new FakeTts(), new FakePlayback(true), { micMode: 'open-mic' });
    const pending2 = h2.loop.speak('narration two');
    await flush(10);
    h2.loop.setMuted(true);
    h2.loop.barge('vad');
    expect(h2.playback.cancelCalls).toBe(0);
    h2.loop.setMuted(false);
    h2.loop.barge('vad');
    expect(h2.playback.cancelCalls).toBe(1);
    await expect(pending2).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('should cancel a narration that is still synthesizing without playing', async () => {
    const tts = new FakeTts({ hangSynth: true });
    const playback = new FakePlayback(true);
    const h = harness(tts, playback, { micMode: 'open-mic' });
    const pending = h.loop.speak('slow synth narration');
    await flush(10);
    h.loop.barge('key');
    tts.release();
    const result = await pending;
    expect(result.status).toBe('cancelled');
    expect(playback.calls).toHaveLength(0);
    expect(h.events.map((event) => event.type)).toEqual(['narration-start', 'narration-cancelled']);
  });

  it('should wire the controller keys: toggle barges, stop ends the loop', async () => {
    const h = harness(new FakeTts(), new FakePlayback(true), { micMode: 'key' });
    const controlEvents: TerminalControlEvent[] = [];
    const controller = new TerminalController((event) => {
      controlEvents.push(event);
      if (event.kind === 'mic-toggle') {
        h.loop.setMicOn(true);
        h.loop.barge('key');
      }
      if (event.kind === 'mic-mode') h.loop.setMicMode('open-mic');
      if (event.kind === 'stop') void h.loop.stop();
    });
    const listeners = new Set<(chunk: Buffer) => void>();
    controller.attach({
      on: (_event: 'data', listener: (chunk: Buffer) => void) => {
        listeners.add(listener);
      },
      off: (_event: 'data', listener: (chunk: Buffer) => void) => {
        listeners.delete(listener);
      },
    });
    const pending = h.loop.speak('narration interrupted by key');
    await flush(10);
    for (const listener of listeners) listener(Buffer.from('m', 'utf8'));
    const result = await pending;
    expect(result.status).toBe('cancelled');
    expect(h.events.map((event) => event.type)).toEqual(['narration-start', 'narration-chunk', 'narration-cancelled']);
    expect(controlEvents).toEqual([{ kind: 'mic-toggle' }]);
    // Unbound keys never reach the narration: no new control events fire.
    const second = h.loop.speak('clean narration');
    await flush(10);
    for (const listener of listeners) listener(Buffer.from('xq', 'utf8'));
    await flush(10);
    expect(controlEvents).toEqual([{ kind: 'mic-toggle' }]);
    h.playback.complete();
    await expect(second).resolves.toMatchObject({ status: 'played' });
    const transcript = JSON.stringify(h.events);
    expect(transcript).not.toMatch(/"text":"[^"]*[xq]/);
    controller.detach();
    eventHygiene(h);
  });

  it('should stop on the stop key and close the loop', async () => {
    const h = harness(new FakeTts(), new FakePlayback(true), { micMode: 'open-mic' });
    const controller = new TerminalController((event) => {
      if (event.kind === 'stop') void h.loop.stop();
    });
    const listeners = new Set<(chunk: Buffer) => void>();
    controller.attach({
      on: (_event: 'data', listener: (chunk: Buffer) => void) => {
        listeners.add(listener);
      },
      off: (_event: 'data', listener: (chunk: Buffer) => void) => {
        listeners.delete(listener);
      },
    });
    const pending = h.loop.speak('narration to stop');
    await flush(10);
    for (const listener of listeners) listener(Buffer.from('s', 'utf8'));
    const result = await pending;
    expect(result.status).toBe('cancelled');
    expect(h.events.map((event) => event.type)).toEqual(['narration-start', 'narration-chunk', 'narration-cancelled']);
    expect(h.loop.diagnostics().closed).toBe(true);
    await h.loop.close();
    controller.detach();
    eventHygiene(h);
  });

  it('should cancel through the real capture VAD path on speech onset', async () => {
    const h = harness(new FakeTts(), new FakePlayback(true), { micMode: 'open-mic' });
    const device = new FakeDevice([[tone(0.3), silence(0.3)]]);
    const capture = new CaptureSession(
      device,
      { ...CAPTURE_OPTS, maxMailboxFrames: 8 },
      { onSpeechStart: () => h.loop.barge('vad') },
    );
    const pending = h.loop.speak('narration interrupted by voice');
    await flush(5);
    await capture.open('fake-default');
    await flush(20);
    expect(h.playback.cancelCalls).toBe(1);
    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    await capture.close();
    eventHygiene(h);
  });

  it('should reject a second narration while speaking and refuse empty text', async () => {
    const h = harness(new FakeTts(), new FakePlayback(true), { micMode: 'open-mic' });
    const pending = h.loop.speak('first narration');
    await flush(10);
    await expect(h.loop.speak('second narration')).rejects.toThrow(VoiceLoopBusyError);
    await expect(h.loop.speak('   ')).rejects.toThrow(VoiceLoopBusyError);
    h.loop.barge('key');
    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    await expect(h.loop.speak('')).rejects.toThrow(VoiceLoopRefusedError);
    expect(h.events.filter((event) => event.type === 'narration-start')).toHaveLength(1);
  });

  it('should surface engine and playback failures with terminal events', async () => {
    const h = harness(new FakeTts({ synthError: 'synth boom' }), new FakePlayback(false), { micMode: 'open-mic' });
    await expect(h.loop.speak('doomed narration')).rejects.toThrow('synth boom');
    expect(h.events.map((event) => event.type)).toEqual(['narration-start', 'tts-error']);
    const h2 = harness(new FakeTts(), new FakePlayback(false, new Error('speaker gone')), { micMode: 'open-mic' });
    await expect(h2.loop.speak('doomed playback')).rejects.toThrow('speaker gone');
    expect(h2.events.map((event) => event.type)).toEqual(['narration-start', 'narration-chunk', 'playback-error']);
  });

  it('should never spawn real playback for a barge that lands during synthesis', async () => {
    const pidFile = join(tmpdir(), `voice-loop-prespawn-${process.pid}.pid`);
    rmSync(pidFile, { force: true });
    try {
      await withEnv({ FAKE_APLAY_MODE: 'hang', FAKE_APLAY_PIDFILE: pidFile }, async () => {
        const tts = new FakeTts({ hangSynth: true });
        const playback = new AplayPlayback(FAKE_APLAY, [digestOf(FAKE_APLAY)]);
        const h = harness(tts, playback, { micMode: 'open-mic' });
        const pending = h.loop.speak('barge arrives before any spawn');
        await flush(10);
        h.loop.barge('key');
        tts.release();
        await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
        expect(playback.playing).toBe(false);
        await expect((async () => readFileSync(pidFile, 'utf8'))()).rejects.toThrow(/ENOENT/);
      });
    } finally {
      rmSync(pidFile, { force: true });
    }
  });

  it('should reap real playback on a mid-play barge within the bound', async () => {
    const pidFile = join(tmpdir(), `voice-loop-midplay-${process.pid}.pid`);
    rmSync(pidFile, { force: true });
    try {
      await withEnv({ FAKE_APLAY_MODE: 'hang', FAKE_APLAY_PIDFILE: pidFile }, async () => {
        const playback = new AplayPlayback(FAKE_APLAY, [digestOf(FAKE_APLAY)]);
        const h = harness(new FakeTts(), playback, { micMode: 'open-mic' });
        const pending = h.loop.speak('barge arrives mid-play');
        const deadline = Date.now() + 10000;
        while (!playback.playing && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(playback.playing).toBe(true);
        const start = Date.now();
        h.loop.barge('vad');
        await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
        expect(Date.now() - start).toBeLessThanOrEqual(150);
        const pid = Number(readFileSync(pidFile, 'utf8').trim());
        expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
      });
    } finally {
      rmSync(pidFile, { force: true });
    }
  });

  it('should map close-during-playback to cancelled, not playback-error', async () => {
    const h = harness(new FakeTts(), new FakePlayback(true), { micMode: 'open-mic' });
    const pending = h.loop.speak('narration closed mid-play');
    await flush(10);
    await h.loop.close();
    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    expect(h.events.map((event) => event.type)).toEqual(['narration-start', 'narration-chunk', 'narration-cancelled']);
  });

  it('should keep the §8.1 receipt blocked and never claim native evidence', () => {
    const receiptPath = fileURLToPath(new URL('../bench/l6a-g-native.receipt.json', import.meta.url));
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      status: string;
      blocked: Record<string, { status: string; detail: string }>;
    };
    expect(receipt.status).toBe('blocked');
    for (const key of ['liveTtsVoice', 'openMicEcho', 'inImageHelpers']) {
      expect(receipt.blocked[key]?.status).toBe('blocked');
      expect(receipt.blocked[key]?.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('barge sources', () => {
  it('should ignore barge-in with nothing speaking', () => {
    const h = harness();
    const sources: BargeSource[] = ['vad', 'key', 'stop'];
    for (const source of sources) h.loop.barge(source);
    expect(h.events).toEqual([]);
    expect(h.playback.cancelCalls).toBe(0);
  });
});
