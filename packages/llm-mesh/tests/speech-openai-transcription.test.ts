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
