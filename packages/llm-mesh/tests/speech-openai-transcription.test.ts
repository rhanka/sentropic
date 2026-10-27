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
  type SpeechSessionRequest,
  type SpeechTranscript,
} from '../src/speech/contracts.js';
import {
  buildTranscriptionSessionUpdate,
  openAiTranscriptionCapabilities,
  openAiTranscriptionDelays,
  OpenAiTranscriptionError,
  openTranscriptionSession,
  type OpenAiTranscriptionConnect,
  type OpenAiTranscriptionProfileConfig,
  type OpenAiTranscriptionSocket,
  type OpenAiTranscriptionUsageSink,
} from '../src/speech/openai-transcription.js';
import {
  frameCompleted,
  frameDelta,
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

const admission = (overrides: Partial<Record<string, unknown>> = {}) => ({
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

class ScriptSocket implements OpenAiTranscriptionSocket {
  sent: string[] = [];
  closed = false;
  connectHeaders?: { readonly authorization: string; readonly originator: string };
  constructor(private readonly frames: readonly string[] = []) {}
  send(message: string): void {
    if (this.closed) throw new Error('socket closed');
    this.sent.push(message);
  }
  async *messages(): AsyncGenerator<string> {
    for (const frame of this.frames) yield frame;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

/** Never yields until closed: models a live provider stream for abort tests. */
class HangSocket extends ScriptSocket {
  private release?: () => void;
  override async *messages(): AsyncGenerator<string> {
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
  override async close(): Promise<void> {
    await super.close();
    this.release?.();
  }
}

class RecordingSink implements OpenAiTranscriptionUsageSink {
  records: Array<{ eventId: string; revision: number; mode: string; usage: unknown }> = [];
  settles: Array<{ operationId: string; outcome: string; usage: unknown; providerRevision?: number }> = [];
  record(update: { eventId: string; revision: number; mode: 'cumulative' | 'incremental'; usage: unknown }): void {
    this.records.push(update as RecordingSink['records'][number]);
  }
  settle(request: { operationId: string; outcome: 'completed' | 'cancelled' | 'failed'; usage: unknown }): void {
    this.settles.push(request as RecordingSink['settles'][number]);
  }
}

const sentTypes = (socket: ScriptSocket): string[] =>
  socket.sent.map((message) => (JSON.parse(message) as { type: string }).type);

const collectEvents = async (session: { events: AsyncIterable<SpeechEvent> }, max = 50): Promise<SpeechEvent[]> => {
  const out: SpeechEvent[] = [];
  for await (const event of session.events) {
    out.push(event);
    if (out.length >= max) break;
  }
  return out;
};

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
    expect(() => openAiTranscriptionCapabilities(config as never)).toThrowError(OpenAiTranscriptionError);
    try {
      openAiTranscriptionCapabilities(config as never);
      expect.unreachable();
    } catch (error) {
      expect((error as OpenAiTranscriptionError).code).toBe(code);
    }
  });

  it('should refuse to open without admission, credential, or STT-only chained binding', async () => {
    const socket = new ScriptSocket();
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
  const openScripted = async (frames: readonly string[], config = liveConfig) => {
    const socket = new ScriptSocket(frames);
    let clock = 1_000;
    const sink = new RecordingSink();
    const session = await openTranscriptionSession(config, {
      request: sessionRequest(config.modelId),
      admission: admission(),
      bearerToken: 'bearer-fixture',
      connect: async () => socket,
      usage: sink,
      nowMs: () => clock,
    });
    return {
      session, socket, sink,
      advance: (ms: number): void => {
        clock += ms;
      },
    };
  };

  it('should emit ordered partials then a final that rebuilds through the contract', async () => {
    const { session, socket } = await openScripted(frameScriptFr);
    expect(sentTypes(socket)[0]).toBe('session.update');
    const events = await collectEvents(session);
    const partials = events.filter((event) => event.type === 'transcript.partial');
    const finals = events.filter((event) => event.type === 'transcript.final');
    expect(partials.map((event) => (event as { revision: number }).revision)).toEqual([1, 2, 3]);
    expect(partials.map((event) => (event as { replaces: unknown }).replaces)).toEqual([
      { start: 0, end: 0 }, { start: 9, end: 9 }, { start: 23, end: 23 },
    ]);
    expect(finals).toHaveLength(1);
    const final = finals[0] as unknown as Record<string, unknown>;
    expect(final.utteranceId).toBe('item_fr1');
    expect(final.text).toBe("Bonjour, pouvez-vous m'entendre ?");
    expect(final.language).toBe('fr');
    expect(final.revision).toBe(4);
    // The contract projection rebuilds the final from the partial stream.
    let rebuilt: SpeechTranscript | undefined;
    for (const event of events) {
      if (event.type === 'transcript.partial' || event.type === 'transcript.final') {
        rebuilt = reviseSpeechTranscript(rebuilt, event as SpeechTranscript) ?? rebuilt;
      }
    }
    expect(rebuilt?.text).toBe(final.text);
  });

  it('should let a completion correct the accumulated hypothesis', async () => {
    const { session } = await openScripted(frameScriptEnCorrected, whisperConfig);
    const events = await collectEvents(session);
    const final = events.find((event) => event.type === 'transcript.final') as unknown as Record<string, unknown>;
    expect(final.text).toBe('Hello, world');
    expect(final.language).toBe('en');
  });

  it('should keep out-of-order completions keyed by item', async () => {
    const { session } = await openScripted(frameScriptOutOfOrder);
    const events = await collectEvents(session);
    const finals = events
      .filter((event) => event.type === 'transcript.final')
      .map((event) => (event as unknown as { utteranceId: string; text: string; revision: number }));
    expect(finals).toEqual([
      { utteranceId: 'item_b', text: 'second tour', revision: 2 },
      { utteranceId: 'item_a', text: 'premier tour', revision: 3 },
    ]);
  });

  it('should surface invalid frames as error events and continue the stream', async () => {
    const { session } = await openScripted(frameScriptInvalid);
    const events = await collectEvents(session);
    const errors = events.filter((event) => event.type === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors[0]).toMatchObject({ reason: 'invalid-format', retryable: true });
    const providerError = errors.find((event) => (event as { reason: string }).reason === 'provider-error');
    expect(providerError).toMatchObject({ retryable: false });
    const final = events.find((event) => event.type === 'transcript.final') as unknown as Record<string, unknown>;
    expect(final?.utteranceId).toBe('item_ok');
    expect(final?.text).toBe('kept going');
  });

  it('should reject a duplicate final for the same item', async () => {
    const { session } = await openScripted([
      frameDelta('item_1', 'hello '),
      frameCompleted('item_1', 'hello'),
      frameCompleted('item_1', 'hello again'),
    ]);
    const events = await collectEvents(session);
    expect(events.filter((event) => event.type === 'transcript.final')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
  });
});

describe('openai session lifecycle', () => {
  it('should refuse to connect when the signal is already aborted', async () => {
    let connected = 0;
    const connect: OpenAiTranscriptionConnect = async () => {
      connected += 1;
      return new ScriptSocket();
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
    // The abort handler closes asynchronously; wait for the settlement.
    const deadline = Date.now() + 10_000;
    while (sink.settles.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await session.close();
    expect(socket.closed).toBe(true);
    expect(sink.settles).toEqual([{
      operationId: 'op-1',
      outcome: 'cancelled',
      usage: { connectedSeconds: 2, admittedAudioSeconds: 0 },
    }]);
    await expect(session.write(frame('u1', 10))).rejects.toMatchObject({ code: 'closed' });
  });

  it('should meter audio seconds and refuse past the admitted ceiling', async () => {
    const socket = new ScriptSocket();
    const sink = new RecordingSink();
    const session = await openTranscriptionSession(liveConfig, {
      request: sessionRequest('gpt-live-transcribe'),
      admission: admission({ ceiling: { connectedSeconds: 60, admittedAudioSeconds: 0.03 } }),
      bearerToken: 'bearer-fixture',
      connect: async () => socket,
      usage: sink,
      nowMs: () => 1_000,
    });
    await session.write(frame('u1', 10, 480));
    expect(socket.sent.filter((message) => JSON.parse(message).type === 'input_audio_buffer.append')).toHaveLength(1);
    await expect(session.write(frame('u1', 30, 480))).rejects.toMatchObject({ code: 'ceiling' });
    await session.command({ schemaVersion: 1, speechSessionId: 'speech-op-1', connectionEpoch: 3,
      eventId: 'cmd-1', sequence: 1, clock: { id: 'test', monotonicMs: 1 },
      type: 'input.commit', utteranceId: 'u1' });
    expect(sink.records).toEqual([{
      eventId: 'u1', revision: 0, mode: 'incremental', usage: { admittedAudioSeconds: 0.02 },
    }]);
    expect(JSON.stringify(sink)).not.toContain('transcript');
    await session.close();
  });

  it('should keep profiles independent on separate sockets and sinks', async () => {
    const liveSocket = new ScriptSocket(frameScriptFr);
    const whisperSocket = new ScriptSocket(frameScriptEnCorrected);
    const liveSink = new RecordingSink();
    const whisperSink = new RecordingSink();
    const open = (config: typeof liveConfig, socket: ScriptSocket, sink: RecordingSink) =>
      openTranscriptionSession(config, {
        request: sessionRequest(config.modelId),
        admission: admission({ operationId: `op-${config.modelId}` }),
        bearerToken: 'bearer-fixture',
        connect: async () => socket,
        usage: sink,
        nowMs: () => 1_000,
      });
    const [live, whisper] = await Promise.all([
      open(liveConfig, liveSocket, liveSink), open(whisperConfig, whisperSocket, whisperSink),
    ]);
    const [liveEvents, whisperEvents] = await Promise.all([collectEvents(live), collectEvents(whisper)]);
    expect(liveEvents.filter((event) => event.type === 'transcript.final')).toHaveLength(1);
    expect(whisperEvents.filter((event) => event.type === 'transcript.final')).toHaveLength(1);
    expect(liveSocket.sent).not.toEqual(whisperSocket.sent);
    expect(liveSink.settles).toHaveLength(1);
    expect(whisperSink.settles).toHaveLength(1);
  });

  it('should never surface the bearer [REDACTED] in failures and store no audio', async () => {
    const failingConnect: OpenAiTranscriptionConnect = async () => {
      throw new Error('provider connect failed (status 401)');
    };
    await expect(openTranscriptionSession(liveConfig, {
      request: sessionRequest('gpt-live-transcribe'),
      admission: admission(),
      bearerToken: 'bearer-secret-fixture',
      connect: failingConnect,
      usage: new RecordingSink(),
    })).rejects.toThrowError(/provider connect failed \(status 401\)/);
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
      expect(JSON.stringify(new RecordingSink())).not.toContain('bearer-secret-fixture');
    }
    const socket = new ScriptSocket();
    const session = await openTranscriptionSession(liveConfig, {
      request: sessionRequest('gpt-live-transcribe'),
      admission: admission(),
      bearerToken: 'bearer-secret-fixture',
      connect: async (url, headers) => {
        expect(headers.authorization).toBe('bearer-secret-fixture');
        expect(url).toBe('wss://api.openai.com/v1/realtime?intent=transcription');
        return socket;
      },
      usage: new RecordingSink(),
      nowMs: () => 1_000,
    });
    await session.write(frame('u1', 10, 24));
    const append = JSON.parse(socket.sent[1] as string) as { audio: string };
    expect(Buffer.from(append.audio, 'base64')).toEqual(Buffer.alloc(48));
    expect(session).not.toHaveProperty('bearerToken');
    await session.close();
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
