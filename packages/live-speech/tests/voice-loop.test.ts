// Voice-loop tests (r3 L6a): fence barge-in on both mic modes, stop, busy,
// refused and engine-failure paths, bounded narration, key hygiene, VAD
// wiring through the real L4 capture, and the blocked §8.1 receipt guard.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CaptureSession } from '../src/node/capture.js';
import { TerminalController, type TerminalControlEvent } from '../src/node/terminal-control.js';
import type { PlaybackPort } from '../src/node/playback.js';
import { PlaybackCancelledError } from '../src/node/playback.js';
import type { TtsAudio, TtsEnginePort } from '../src/node/tts-registry.js';
import {
  boundNarration,
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
  readonly capabilities = { streaming: false as const, fileBased: true as const, maxChars: 500 };
  calls: string[] = [];
  closeCount = 0;
  private releaseSynth: (() => void) | null = null;
  constructor(options: FakeTtsOptions = {}) {
    this.engineId = options.engineId ?? 'fake-tts/1';
    if (options.hangSynth === true) this.hang = true;
    if (options.synthError !== undefined) this.failure = options.synthError;
  }
  private hang = false;
  private failure: string | null = null;
  async synthesize(text: string): Promise<TtsAudio> {
    this.calls.push(text);
    if (this.failure !== null) throw new Error(this.failure);
    if (this.hang) await new Promise<void>((resolve) => (this.releaseSynth = resolve));
    return { wav: stubWav(), voice: 'fake', chars: text.length };
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
    this.failPlay?.(new PlaybackCancelledError());
    this.releasePlay = null;
    this.failPlay = null;
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

function harness(tts?: FakeTts, playback?: FakePlayback, micMode: 'key' | 'open-mic' = 'key'): Harness {
  const events: VoiceLoopEvent[] = [];
  const fakeTts = tts ?? new FakeTts();
  const fakePlayback = playback ?? new FakePlayback();
  const loop = new VoiceLoop({ tts: fakeTts, playback: fakePlayback, emit: (event) => events.push(event), micMode });
  return { loop, tts: fakeTts, playback: fakePlayback, events };
}

function eventHygiene(h: Harness): void {
  assertNoAudioPayload(h.events);
  assertNoAudioPayload(h.loop.diagnostics());
  const text = JSON.stringify(h.events);
  expect(text).not.toMatch(/RIFF/);
}

describe('bound narration', () => {
  it('should leave short text untouched and cut long text at a clause', () => {
    expect(boundNarration('hello world', 480)).toBe('hello world');
    expect(boundNarration('  padded  ', 480)).toBe('padded');
    const long = 'First clause here. Second clause follows the first one today.';
    expect(boundNarration(long, 25)).toBe('First clause here.');
    expect(boundNarration('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefghij');
    expect(boundNarration('', 480)).toBe('');
  });
});

describe('voice loop', () => {
  it('should play a narration end to end and report counts only', async () => {
    const h = harness(new FakeTts(), new FakePlayback(false));
    const result = await h.loop.speak('hello world');
    expect(result).toMatchObject({ status: 'played', chars: 11 });
    expect(h.events).toEqual([
      { type: 'narration-start', narrationId: result.narrationId, chars: 11 },
      { type: 'narration-played', narrationId: result.narrationId, chars: 11 },
    ]);
    expect(h.loop.diagnostics()).toMatchObject({ speaking: false, played: 1, cancelled: 0 });
    expect(h.tts.calls).toEqual(['hello world']);
    eventHygiene(h);
  });

  it('should cancel playback within the barge call on open-mic VAD onset', async () => {
    const h = harness(new FakeTts(), new FakePlayback(true), 'open-mic');
    const pending = h.loop.speak('a long narration that keeps playing');
    await flush(10);
    expect(h.playback.calls).toHaveLength(1);
    h.loop.barge('vad');
    // Fence: the playback cancel fired synchronously inside barge(), with no
    // timers or awaits between the onset and the kill.
    expect(h.playback.cancelCalls).toBe(1);
    const result = await pending;
    expect(result.status).toBe('cancelled');
    expect(h.events.map((event) => event.type)).toEqual(['narration-start', 'narration-cancelled']);
    expect(h.loop.diagnostics().cancelled).toBe(1);
    eventHygiene(h);
  });

  it('should gate VAD barge-in on mic state in key mode and never when muted', async () => {
    const h = harness(new FakeTts(), new FakePlayback(true), 'key');
    const pending = h.loop.speak('narration one');
    await flush(10);
    h.loop.barge('vad');
    expect(h.playback.cancelCalls).toBe(0);
    h.loop.setMicOn(true);
    h.loop.barge('vad');
    expect(h.playback.cancelCalls).toBe(1);
    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    const h2 = harness(new FakeTts(), new FakePlayback(true), 'open-mic');
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
    const h = harness(tts, playback, 'open-mic');
    const pending = h.loop.speak('slow synth narration');
    await flush(10);
    h.loop.barge('key');
    tts.release();
    const result = await pending;
    expect(result.status).toBe('cancelled');
    expect(playback.calls).toHaveLength(0);
    expect(h.events.map((event) => event.type)).toEqual(['narration-start', 'narration-cancelled']);
  });

  it('should stop on the stop key and close the loop', async () => {
    const h = harness(new FakeTts(), new FakePlayback(true), 'open-mic');
    const controlEvents: TerminalControlEvent[] = [];
    const controller = new TerminalController((event) => {
      controlEvents.push(event);
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
    expect(h.events.map((event) => event.type)).toEqual(['narration-start', 'narration-cancelled']);
    expect(h.loop.diagnostics().closed).toBe(true);
    await h.loop.close();
    await expect(h.loop.speak('after close')).rejects.toThrow(VoiceLoopClosedError);
    expect(controlEvents).toEqual([{ kind: 'stop' }]);
    eventHygiene(h);
  });

  it('should ignore unbound keys without leaking them anywhere', async () => {
    const h = harness(new FakeTts(), new FakePlayback(false), 'key');
    const controller = new TerminalController(() => {});
    const listeners = new Set<(chunk: Buffer) => void>();
    controller.attach({
      on: (_event: 'data', listener: (chunk: Buffer) => void) => {
        listeners.add(listener);
      },
      off: (_event: 'data', listener: (chunk: Buffer) => void) => {
        listeners.delete(listener);
      },
    });
    for (const listener of listeners) listener(Buffer.from('xq', 'utf8'));
    await h.loop.speak('clean narration');
    await flush(10);
    expect(JSON.stringify(h.events)).not.toMatch(/[xq]/);
    controller.detach();
    eventHygiene(h);
  });

  it('should cancel through the real capture VAD path on speech onset', async () => {
    const h = harness(new FakeTts(), new FakePlayback(true), 'open-mic');
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
    const h = harness(new FakeTts(), new FakePlayback(true), 'open-mic');
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
    const h = harness(new FakeTts({ synthError: 'synth boom' }), new FakePlayback(false), 'open-mic');
    await expect(h.loop.speak('doomed narration')).rejects.toThrow('synth boom');
    expect(h.events.map((event) => event.type)).toEqual(['narration-start', 'tts-error']);
    const h2 = harness(new FakeTts(), new FakePlayback(false, new Error('speaker gone')), 'open-mic');
    await expect(h2.loop.speak('doomed playback')).rejects.toThrow('speaker gone');
    expect(h2.events.map((event) => event.type)).toEqual(['narration-start', 'playback-error']);
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
