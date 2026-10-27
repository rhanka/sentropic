// OpenAI streaming STT profiles (L9 gate): per-model VAD/commit, partial/final
// order, invalid format, abort and usage. Recorded frames only; no live call.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  negotiateSpeech,
  type SpeechCapabilities,
} from '../src/speech/capabilities.js';
import {
  reviseSpeechTranscript,
  type SpeechEvent,
  type SpeechInputFrame,
  type SpeechSession,
  type SpeechSessionRequest,
  type SpeechTranscript,
} from '../src/speech/contracts.js';
import {
  buildTranscriptionSessionUpdate,
  openAiTranscriptionCapabilities,
  OpenAiTranscriptionError,
  openTranscriptionSession,
  type OpenAiTranscriptionConnect,
  type OpenAiTranscriptionProfileConfig,
  type OpenAiTranscriptionSocket,
  type OpenAiTranscriptionUsageSink,
} from '../src/speech/openai-transcription.js';
import {
  frameCompleted,
  frameCommitted,
  frameDelta,
  frameScriptCompletedOnly,
  frameScriptEnCorrected,
  frameScriptFr,
  frameScriptInvalid,
  frameScriptOutOfOrder,
} from './fixtures/openai-transcription-frames.js';

const liveConfig: OpenAiTranscriptionProfileConfig = {
  modelId: 'gpt-live-transcribe', modelRevision: 'rev-2026-10-23', delay: 'low', language: 'fr',
};
const whisperConfig: OpenAiTranscriptionProfileConfig = {
  modelId: 'gpt-realtime-whisper', modelRevision: 'rev-2026-10-23', delay: 'medium', language: 'en',
};

const admission = (overrides: Record<string, unknown> = {}) => ({
  operationId: 'op-1',
  holdRef: 'hold-1',
  pricingRevision: 'price-r1',
  ceiling: { connectedSeconds: 60, admittedAudioSeconds: 60 },
  maxDurationMs: 60_000,
  ...overrides,
});

const sttBinding = (modelId: string) => ({
  providerId: 'openai',
  modelId,
  modelRevision: 'rev-2026-10-23',
  adapterId: 'openai-transcription',
  adapterRevision: '1',
  placement: 'cloud-relay' as const,
});

const sessionRequest = (modelId: string): SpeechSessionRequest => ({
  protocolVersion: 1,
  configuration: { profileId: `openai-${modelId}`, configRevision: 'cfg-r1', policyRef: 'policy' },
  target: { sessionId: 'agent-1', sourceGeneration: 'boot-1', controllerEpoch: 3, consentRevision: 'consent-1' },
  pipeline: 'chained',
  micMode: 'key',
  bindings: { stt: sttBinding(modelId) },
  requiredCapabilities: [],
  inputFormats: [{ codec: 'pcm16-le', sampleRateHz: 24000, channels: 1 }],
  outputFormats: [],
  maxDurationMs: 60_000,
  maxCostUsd: 1,
  budgetRef: 'budget-1',
  allowedPlacements: ['cloud-relay'],
  egressPolicyRef: 'egress-1',
});

/** Provider stream released on demand: the test drives commits, then pushes frames. */
class GateSocket implements OpenAiTranscriptionSocket {
  sent: string[] = [];
  closed = false;
  private frames: string[] = [];
  private waiters: Array<() => void> = [];
  private ended = false;
  send(message: string): void {
    if (this.closed) throw new Error('socket closed');
    this.sent.push(message);
  }
  push(...frames: string[]): void {
    this.frames.push(...frames);
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }
  async *messages(): AsyncGenerator<string> {
    let index = 0;
    for (;;) {
      while (index < this.frames.length) yield this.frames[index++] as string;
      if (this.ended) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.ended = true;
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}

/** Never yields until closed: models a live provider stream for abort tests. */
class HangSocket implements OpenAiTranscriptionSocket {
  sent: string[] = [];
  closed = false;
  private release?: () => void;
  send(message: string): void {
    if (this.closed) throw new Error('socket closed');
    this.sent.push(message);
  }
  async *messages(): AsyncGenerator<string> {
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    this.release?.();
  }
}

class RecordingSink implements OpenAiTranscriptionUsageSink {
  records: Array<{ eventId: string; revision: number; mode: string; usage: unknown }> = [];
  settles: Array<{ operationId: string; outcome: string; usage?: unknown; providerRevision?: number }> = [];
  record(update: { eventId: string; revision: number; mode: 'cumulative' | 'incremental'; usage: unknown }): void {
    this.records.push(update as RecordingSink['records'][number]);
  }
  settle(request: { operationId: string; outcome: 'completed' | 'cancelled' | 'failed'; usage?: unknown }): void {
    this.settles.push(request as RecordingSink['settles'][number]);
  }
}

const frame = (utteranceId: string, capturedAtMs: number, samples = 480): SpeechInputFrame => ({
  type: 'audio.input',
  schemaVersion: 1,
  speechSessionId: 'speech-op-1',
  connectionEpoch: 3,
  eventId: `cap-${capturedAtMs}`,
  sequence: capturedAtMs,
  clock: { id: 'capture', monotonicMs: capturedAtMs },
  streamId: 'mic',
  utteranceId,
  capturedAtMs,
  sampleCount: samples,
  format: { codec: 'pcm16-le', sampleRateHz: 24000, channels: 1 },
  payload: new Uint8Array(samples * 2),
});

const commitCommand = (utteranceId: string) => ({
  schemaVersion: 1 as const,
  speechSessionId: 'speech-op-1',
  connectionEpoch: 3,
  eventId: `cmd-${utteranceId}`,
  sequence: 1,
  clock: { id: 'test', monotonicMs: 1 },
  type: 'input.commit' as const,
  utteranceId,
});

const flush = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const openDriven = async (config = liveConfig, overrides: Record<string, unknown> = {}) => {
  const socket = new GateSocket();
  let clock = 1_000;
  const sink = new RecordingSink();
  const expiries: Array<{ ms: number; fn: () => void }> = [];
  const session = await openTranscriptionSession(config, {
    request: sessionRequest(config.modelId),
    admission: admission(),
    bearerToken: 'bearer-fixture',
    connect: async () => socket,
    usage: sink,
    nowMs: () => clock,
    schedule: (ms, fn) => {
      expiries.push({ ms, fn });
      return () => {
        const index = expiries.findIndex((entry) => entry.fn === fn);
        if (index >= 0) expiries.splice(index, 1);
      };
    },
    ...overrides,
  });
  return {
    session,
    socket,
    sink,
    expiries,
    advance: (ms: number): void => {
      clock += ms;
    },
    turn: async (utteranceId: string, capturedAtMs: number, samples = 480): Promise<void> => {
      await session.write(frame(utteranceId, capturedAtMs, samples));
      await session.command(commitCommand(utteranceId));
    },
    collect: async (): Promise<SpeechEvent[]> => {
      await flush();
      await session.close();
      const out: SpeechEvent[] = [];
      for await (const event of session.events) out.push(event);
      return out;
    },
  };
};

describe('openai transcription profiles', () => {
  it.each([liveConfig, whisperConfig])('should expose independent capabilities for $modelId', (config) => {
    const caps = openAiTranscriptionCapabilities(config);
    expect(caps.binding).toMatchObject({
      providerId: 'openai', modelId: config.modelId, adapterId: 'openai-transcription', placement: 'cloud-relay',
    });
    expect(caps.features).toMatchObject({
      streamingStt: 'supported', partialTranscript: 'supported', clientVad: 'supported', manualCommit: 'supported',
      serverVad: 'unsupported', nativeDuplex: 'unsupported', tts: 'unsupported',
    });
    expect(caps.inputFormats).toEqual([{ codec: 'pcm16-le', sampleRateHz: 24000, channels: 1 }]);
    expect(caps.usageUnits).toEqual(expect.arrayContaining(['audio-seconds', 'session-seconds']));
  });

  it('should refuse TTS selection without an implicit synthesis voice', () => {
    for (const config of [liveConfig, whisperConfig]) {
      const caps: SpeechCapabilities = {
        ...openAiTranscriptionCapabilities(config),
        languages: ['fr', 'en'],
        voices: undefined,
        regions: undefined,
      };
      expect(negotiateSpeech(caps, {
        binding: { ...caps.binding },
        required: ['tts'],
      })).toEqual({ ok: false, reason: 'capability', capability: 'tts', support: 'unsupported' });
      expect('voice' in caps.binding).toBe(false);
    }
  });

  it('should pin server VAD off and keep per-profile delay independent', () => {
    const live = buildTranscriptionSessionUpdate(liveConfig) as { session: { audio: { input: Record<string, unknown> } } };
    const whisper = buildTranscriptionSessionUpdate({ ...whisperConfig, delay: 'high' });
    expect(live.session.audio.input.turn_detection).toBeNull();
    expect(live.session.audio.input).not.toHaveProperty('server_vad');
    expect(live.session.audio.input).not.toHaveProperty('semantic_vad');
    expect((live.session.audio.input.transcription as { delay: string }).delay).toBe('low');
    expect(((whisper as typeof live).session.audio.input.transcription as { delay: string }).delay).toBe('high');
    expect((whisper as typeof live).session.audio.input).toMatchObject({
      format: { type: 'audio/pcm', rate: 24000 },
      transcription: { model: 'gpt-realtime-whisper' },
    });
  });

  it.each([
    [{ ...liveConfig, modelId: 'gpt-unknown' }, 'unknown-model'],
    [{ ...liveConfig, modelRevision: '' }, 'invalid-config'],
    [{ ...liveConfig, delay: 'turbo' }, 'invalid-config'],
    [{ ...liveConfig, turnDetection: 'server' }, 'invalid-config'],
  ])('should refuse unvalidated profile %j', (config, code) => {
    try {
      openAiTranscriptionCapabilities(config as never);
      expect.unreachable();
    } catch (error) {
      expect((error as OpenAiTranscriptionError).code).toBe(code);
    }
  });

  it('should refuse to open without admission, credential, or STT-only chained binding', async () => {
    const socket = new GateSocket();
    const connect: OpenAiTranscriptionConnect = async () => socket;
    const base = {
      request: sessionRequest('gpt-live-transcribe'),
      bearerToken: 'bearer-fixture',
      connect,
      usage: new RecordingSink(),
      nowMs: () => 1_000,
    };
    await expect(openTranscriptionSession(liveConfig, { ...base, admission: undefined as never }))
      .rejects.toMatchObject({ code: 'admission' });
    await expect(openTranscriptionSession(liveConfig, { ...base, admission: admission(), bearerToken: '' }))
      .rejects.toMatchObject({ code: 'invalid-config' });
    await expect(openTranscriptionSession(liveConfig, {
      ...base,
      admission: admission(),
      request: { ...base.request, bindings: { tts: { ...sttBinding('x'), modelId: 'tts' } } },
    })).rejects.toMatchObject({ code: 'invalid-config' });
    expect(socket.sent).toHaveLength(0);
  });
});

describe('openai transcript mapping', () => {
  it('should emit ordered partials under the client id then a final that rebuilds', async () => {
    const driven = await openDriven();
    await driven.turn('u1', 10);
    driven.socket.push(...frameScriptFr);
    const events = await driven.collect();
    const partials = events.filter((event) => event.type === 'transcript.partial');
    const finals = events.filter((event) => event.type === 'transcript.final');
    expect(partials.map((event) => (event as { revision: number }).revision)).toEqual([1, 2, 3]);
    expect(partials.map((event) => (event as { utteranceId: string }).utteranceId)).toEqual(['u1', 'u1', 'u1']);
    expect(partials.map((event) => (event as { replaces: unknown }).replaces)).toEqual([
      { start: 0, end: 0 }, { start: 9, end: 9 }, { start: 23, end: 23 },
    ]);
    expect(finals).toHaveLength(1);
    const final = finals[0] as unknown as Record<string, unknown>;
    expect(final.utteranceId).toBe('u1');
    expect(final.text).toBe("Bonjour, pouvez-vous m'entendre ?");
    expect(final.language).toBe('fr');
    expect(final.revision).toBe(4);
    expect(final.audioInterval).toEqual({ startMs: 10, endMs: 10 });
    let rebuilt: SpeechTranscript | undefined;
    for (const event of events) {
      if (event.type === 'transcript.partial' || event.type === 'transcript.final') {
        rebuilt = reviseSpeechTranscript(rebuilt, event as SpeechTranscript) ?? rebuilt;
      }
    }
    expect(rebuilt?.text).toBe(final.text);
  });

  it('should let a completion correct the accumulated hypothesis', async () => {
    const driven = await openDriven(whisperConfig);
    await driven.turn('u_en', 20);
    driven.socket.push(...frameScriptEnCorrected);
    const events = await driven.collect();
    const final = events.find((event) => event.type === 'transcript.final') as unknown as Record<string, unknown>;
    expect(final.utteranceId).toBe('u_en');
    expect(final.text).toBe('Hello, world');
    expect(final.language).toBe('en');
  });

  it('should keep out-of-order completions keyed by item', async () => {
    const driven = await openDriven();
    await driven.turn('u_a', 10);
    await driven.turn('u_b', 30);
    driven.socket.push(...frameScriptOutOfOrder);
    const events = await driven.collect();
    const finals = events
      .filter((event) => event.type === 'transcript.final')
      .map((event) => {
        const final = event as unknown as { utteranceId: string; text: string; revision: number };
        return { utteranceId: final.utteranceId, text: final.text, revision: final.revision };
      });
    expect(finals).toEqual([
      { utteranceId: 'u_b', text: 'second tour', revision: 2 },
      { utteranceId: 'u_a', text: 'premier tour', revision: 3 },
    ]);
  });

  it('should create the item on a completion without prior deltas', async () => {
    const driven = await openDriven();
    await driven.turn('u_solo', 40);
    driven.socket.push(...frameScriptCompletedOnly);
    const events = await driven.collect();
    const finals = events.filter((event) => event.type === 'transcript.final');
    expect(finals).toHaveLength(1);
    const final = finals[0] as unknown as Record<string, unknown>;
    expect(final.utteranceId).toBe('u_solo');
    expect(final.revision).toBe(1);
    expect(final.text).toBe('un tour silencieux');
  });

  it('should surface invalid frames as error events and continue the stream', async () => {
    const driven = await openDriven();
    await driven.turn('u_ok', 10);
    driven.socket.push(...frameScriptInvalid);
    const events = await driven.collect();
    const errors = events.filter((event) => event.type === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors[0]).toMatchObject({ reason: 'invalid-format', retryable: true });
    const providerError = errors.find((event) => (event as { reason: string }).reason === 'provider-error');
    expect(providerError).toMatchObject({ retryable: false });
    const final = events.find((event) => event.type === 'transcript.final') as unknown as Record<string, unknown>;
    expect(final?.utteranceId).toBe('u_ok');
    expect(final?.text).toBe('kept going');
  });

  it('should reject a duplicate final for the same item', async () => {
    const driven = await openDriven();
    await driven.turn('u1', 10);
    driven.socket.push(
      frameDelta('item_1', 'hello '),
      frameCommitted('item_1'),
      frameCompleted('item_1', 'hello'),
      frameCompleted('item_1', 'hello again'),
    );
    const events = await driven.collect();
    expect(events.filter((event) => event.type === 'transcript.final')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
  });

  it('should drop late frames for cleared and finalized turns', async () => {
    const driven = await openDriven();
    await driven.turn('u_keep', 10);
    await driven.turn('u_drop', 30);
    await driven.session.command({
      schemaVersion: 1, speechSessionId: 'speech-op-1', connectionEpoch: 3,
      eventId: 'cmd-clear', sequence: 2, clock: { id: 'test', monotonicMs: 1 },
      type: 'input.clear', utteranceId: 'u_drop',
    });
    driven.socket.push(
      frameDelta('item_keep', 'kept '),
      frameCommitted('item_keep'),
      frameCompleted('item_keep', 'kept'),
      frameDelta('item_keep', 'late '),
    );
    await flush();
    const late: SpeechEvent[] = [];
    for await (const event of driven.session.events) {
      late.push(event);
      if (late.length >= 2) break;
    }
    await driven.session.close();
    expect(late.filter((event) => event.type === 'transcript.partial')).toHaveLength(1);
    expect(late.filter((event) => event.type === 'transcript.final')).toHaveLength(1);
    expect(late.filter((event) => event.type === 'error')).toHaveLength(0);
    const final = late.find((event) => event.type === 'transcript.final') as unknown as Record<string, unknown>;
    expect(final?.utteranceId).toBe('u_keep');
  });

  it('should error on an orphan completion with no client turn', async () => {
    const driven = await openDriven();
    driven.socket.push(frameCompleted('item_orphan', 'nowhere'));
    const events = await driven.collect();
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'transcript.final')).toHaveLength(0);
  });

  it('should error on a committed frame with no client commit', async () => {
    const driven = await openDriven();
    driven.socket.push(frameCommitted('item_orphan'));
    const events = await driven.collect();
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'transcript.final')).toHaveLength(0);
  });
});

describe('openai session lifecycle', () => {
  it('should refuse to connect when the signal is already aborted', async () => {
    let connected = 0;
    const connect: OpenAiTranscriptionConnect = async () => {
      connected += 1;
      return new GateSocket();
    };
    const controller = new AbortController();
