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
