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
