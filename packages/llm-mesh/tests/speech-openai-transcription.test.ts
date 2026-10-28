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
    expect(final.audioInterval).toEqual({ startMs: 10, endMs: 30 });
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
    // u_b is spaced far from u_a: a session-wide window would stretch u_a to
    // u_b's capture time ({10, 100}); each final must carry its own turn.
    const driven = await openDriven();
    await driven.turn('u_a', 10);
    await driven.turn('u_b', 100);
    driven.socket.push(...frameScriptOutOfOrder);
    const events = await driven.collect();
    const finals = events
      .filter((event) => event.type === 'transcript.final')
      .map((event) => {
        const final = event as unknown as {
          utteranceId: string; text: string; revision: number; audioInterval: unknown;
        };
        return {
          utteranceId: final.utteranceId,
          text: final.text,
          revision: final.revision,
          audioInterval: final.audioInterval,
        };
      });
    expect(finals).toEqual([
      { utteranceId: 'u_b', text: 'second tour', revision: 2, audioInterval: { startMs: 100, endMs: 120 } },
      { utteranceId: 'u_a', text: 'premier tour', revision: 3, audioInterval: { startMs: 10, endMs: 30 } },
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

  it('should drop a cleared turn even when its bind arrives after the next commit', async () => {
    // The provider `committed` for the cleared turn lands one RTT after the
    // clear: without the FIFO tombstone it would bind item_drop to u3.
    const driven = await openDriven();
    await driven.turn('u_drop', 10);
    await driven.session.command({
      schemaVersion: 1, speechSessionId: 'speech-op-1', connectionEpoch: 3,
      eventId: 'cmd-clear', sequence: 2, clock: { id: 'test', monotonicMs: 1 },
      type: 'input.clear', utteranceId: 'u_drop',
    });
    await driven.turn('u3', 100);
    driven.socket.push(
      frameCommitted('item_drop'),
      frameDelta('item_drop', 'dropped '),
      frameCompleted('item_drop', 'dropped transcript'),
      frameCommitted('item_3'),
      frameCompleted('item_3', 'third turn'),
    );
    const events = await driven.collect();
    const finals = events.filter((event) => event.type === 'transcript.final');
    expect(finals).toHaveLength(1);
    const final = finals[0] as unknown as Record<string, unknown>;
    expect(final?.utteranceId).toBe('u3');
    expect(final?.text).toBe('third turn');
    expect(final?.audioInterval).toEqual({ startMs: 100, endMs: 120 });
    expect(events.filter((event) => event.type === 'error')).toHaveLength(0);
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
    controller.abort();
    await expect(openTranscriptionSession(liveConfig, {
      request: sessionRequest('gpt-live-transcribe'),
      admission: admission(),
      bearerToken: 'bearer-fixture',
      connect,
      usage: new RecordingSink(),
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' });
    expect(connected).toBe(0);
  });

  it('should close the socket and settle cancelled on abort', async () => {
    const socket = new HangSocket();
    const sink = new RecordingSink();
    let clock = 5_000;
    const controller = new AbortController();
    const session = await openTranscriptionSession(liveConfig, {
      request: sessionRequest('gpt-live-transcribe'),
      admission: admission(),
      bearerToken: 'bearer-fixture',
      connect: async () => socket,
      usage: sink,
      nowMs: () => clock,
      signal: controller.signal,
    });
    clock += 2_000;
    controller.abort();
    const deadline = Date.now() + 10_000;
    while (sink.settles.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await session.close();
    expect(socket.closed).toBe(true);
    // No usage attached: the composition settles from the cumulative records.
    expect(sink.settles).toEqual([{ operationId: 'op-1', outcome: 'cancelled' }]);
    await expect(session.write(frame('u1', 10))).rejects.toMatchObject({ code: 'closed' });
  });

  it('should enforce maxDurationMs with an injectable scheduler', async () => {
    const driven = await openDriven(liveConfig, {
      admission: admission({ maxDurationMs: 500 }),
      request: sessionRequest('gpt-live-transcribe'),
    });
    expect(driven.expiries).toHaveLength(1);
    expect(driven.expiries[0]?.ms).toBe(500);
    await driven.turn('u1', 10);
    driven.advance(600);
    await expect(driven.session.write(frame('u2', 30))).rejects.toMatchObject({ code: 'ceiling' });
    await expect(driven.session.command(commitCommand('u2'))).rejects.toMatchObject({ code: 'ceiling' });
    driven.expiries[0]?.fn();
    await flush();
    expect(driven.socket.closed).toBe(true);
    expect(driven.sink.settles).toEqual([{ operationId: 'op-1', outcome: 'cancelled' }]);
  });

  it('should record cumulative totals under a stable eventId', async () => {
    const driven = await openDriven();
    await driven.turn('u1', 10);
    await driven.turn('u2', 30);
    expect(driven.sink.records).toEqual([
      {
        eventId: 'op-1:audio', revision: 0, mode: 'cumulative',
        usage: { admittedAudioSeconds: 0.02, connectedSeconds: 0 },
      },
      {
        eventId: 'op-1:audio', revision: 1, mode: 'cumulative',
        usage: { admittedAudioSeconds: 0.04, connectedSeconds: 0 },
      },
    ]);
    await driven.session.close();
    expect(driven.sink.settles).toEqual([{ operationId: 'op-1', outcome: 'completed' }]);
  });

  it('should meter audio seconds and refuse past the admitted ceiling', async () => {
    const driven = await openDriven(liveConfig, {
      admission: admission({ ceiling: { connectedSeconds: 60, admittedAudioSeconds: 0.03 } }),
    });
    await driven.session.write(frame('u1', 10, 480));
    expect(driven.socket.sent.filter((message) => JSON.parse(message).type === 'input_audio_buffer.append')).toHaveLength(1);
    await expect(driven.session.write(frame('u1', 30, 480))).rejects.toMatchObject({ code: 'ceiling' });
    // The commit seals the admitted audio; the composition enforces caps on record.
    await driven.session.command(commitCommand('u1'));
    expect(JSON.stringify(driven.sink)).not.toContain('transcript');
    await driven.session.close();
  });

  it('should keep profiles independent on separate sockets and sinks', async () => {
    const open = (config: typeof liveConfig) => openDriven(config, {
      admission: admission({ operationId: `op-${config.modelId}` }),
    });
    const [live, whisper] = await Promise.all([open(liveConfig), open(whisperConfig)]);
    await live.turn('u_fr', 10);
    await whisper.turn('u_en', 10);
    live.socket.push(...frameScriptFr);
    whisper.socket.push(...frameScriptEnCorrected);
    const [liveEvents, whisperEvents] = await Promise.all([live.collect(), whisper.collect()]);
    const liveFinals = liveEvents.filter((event) => event.type === 'transcript.final');
    const whisperFinals = whisperEvents.filter((event) => event.type === 'transcript.final');
    expect(liveFinals).toHaveLength(1);
    expect(whisperFinals).toHaveLength(1);
    expect((liveFinals[0] as unknown as { utteranceId: string }).utteranceId).toBe('u_fr');
    expect((whisperFinals[0] as unknown as { utteranceId: string }).utteranceId).toBe('u_en');
    expect(live.socket.sent).not.toEqual(whisper.socket.sent);
    expect(live.sink.settles).toHaveLength(1);
    expect(whisper.sink.settles).toHaveLength(1);
  });

  it('should redact the bearer token from failures and store no audio', async () => {
    const failingConnect: OpenAiTranscriptionConnect = async () => {
      throw new Error('provider connect failed (status 401, bearer bearer-secret-fixture)');
    };
    try {
      await openTranscriptionSession(liveConfig, {
        request: sessionRequest('gpt-live-transcribe'),
        admission: admission(),
        bearerToken: 'bearer-secret-fixture',
        connect: failingConnect,
        usage: new RecordingSink(),
      });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('bearer-secret-fixture');
      expect(String(error)).toContain('[REDACTED]');
    }
    const driven = await openDriven(liveConfig, { bearerToken: 'bearer-secret-fixture' });
    await driven.session.write(frame('u1', 10, 24));
    const append = JSON.parse(driven.socket.sent[1] as string) as { audio: string };
    expect(Buffer.from(append.audio, 'base64')).toEqual(Buffer.alloc(48));
    expect(driven.session).not.toHaveProperty('bearerToken');
    await driven.session.close();
  });

  it('should keep the G-CLOUD receipt blocked and never claim live evidence', () => {
    const receiptPath = fileURLToPath(new URL('../bench/l9-openai-stt.receipt.json', import.meta.url));
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      status: string;
      missing: Array<{ item: string; status: string }>;
    };
    expect(receipt.status).toBe('blocked');
    for (const item of receipt.missing) {
      expect(item.status).toBe('blocked');
    }
  });
});
