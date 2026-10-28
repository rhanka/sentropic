// Mistral streaming STT + TTS binding (L13 gate): endpoint/final mapping,
// cancel/flush, no double count, late-frame suppression, Bearer redaction,
// per-turn windows. Recorded fixtures only; no live call.
import { describe, expect, it } from 'vitest';
import {
  negotiateSpeech,
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
  buildMistralSessionUpdate,
  buildMistralTtsRequest,
  mistralTranscriptionCapabilities,
  mistralTtsCapabilities,
  mistralTtsVoices,
  MistralTranscriptionError,
  openMistralTranscriptionSession,
  MISTRAL_TRANSCRIPTION_WS_URL,
  type MistralTranscriptionConnect,
  type MistralTranscriptionProfileConfig,
  type MistralTranscriptionSocket,
  type MistralTranscriptionUsageSink,
} from '../src/speech/mistral-transcription.js';
import {
  frameCreated,
  frameDelta,
  frameDone,
  frameError,
  frameScriptAppended,
  frameScriptDoneWithUsage,
  frameScriptFr,
  frameScriptInvalid,
} from './fixtures/mistral-frames.js';

const sttConfig: MistralTranscriptionProfileConfig = {
  modelId: 'voxtral-mini-transcribe-realtime-3',
  modelRevision: 'rev-3-2026-10-28',
  targetStreamingDelayMs: 480,
  language: 'fr',
};

const admission = (overrides: Record<string, unknown> = {}) => ({
  operationId: 'op-1',
  holdRef: 'hold-1',
  pricingRevision: 'price-r1',
  ceiling: { connectedSeconds: 60, admittedAudioSeconds: 60 },
  maxDurationMs: 60_000,
  ...overrides,
});

const sttBinding = () => ({
  providerId: 'mistral',
  modelId: 'voxtral-mini-transcribe-realtime-3',
  modelRevision: 'rev-3-2026-10-28',
  adapterId: 'mistral-transcription',
  adapterRevision: '1',
  placement: 'cloud-relay' as const,
});

const sessionRequest = (): SpeechSessionRequest => ({
  protocolVersion: 1,
  configuration: { profileId: 'mistral-voxtral-realtime-3', configRevision: 'cfg-r1', policyRef: 'policy' },
  target: { sessionId: 'agent-1', sourceGeneration: 'boot-1', controllerEpoch: 3, consentRevision: 'consent-1' },
  pipeline: 'chained',
  micMode: 'key',
  bindings: { stt: sttBinding() },
  requiredCapabilities: [],
  inputFormats: [{ codec: 'pcm16-le', sampleRateHz: 24000, channels: 1 }],
  outputFormats: [],
  maxDurationMs: 60_000,
  maxCostUsd: 1,
  budgetRef: 'budget-1',
  allowedPlacements: ['cloud-relay'],
  egressPolicyRef: 'egress-1',
});

/** Provider stream released on demand: the test drives turns, then pushes frames. */
class GateSocket implements MistralTranscriptionSocket {
  sent: string[] = [];
  closed = false;
  private frames: string[];
  private waiters: Array<() => void> = [];
  private ended = false;
  constructor(initial: readonly string[] = []) {
    this.frames = [...initial];
  }
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
