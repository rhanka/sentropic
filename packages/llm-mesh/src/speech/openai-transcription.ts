// OpenAI streaming STT profiles (L9): `gpt-live-transcribe` and
// `gpt-realtime-whisper` behind the mesh speech contract. Wire facts are
// grounded in the Realtime transcription guide [O7]
// (https://developers.openai.com/api/docs/guides/realtime-transcription,
// fetched 2026-10-23, verified 2026-10-28):
// server-side WebSocket `wss://api.openai.com/v1/realtime?intent=transcription`
// (no `model` in the URL), `session.update` with `type: "transcription"`,
// PCM audio via `input_audio_buffer.append`, per-turn
// `input_audio_buffer.commit`, transcript deltas and completions keyed by
// `item_id` (completion order across turns is NOT guaranteed).
// Both models require client turn boundaries: `turn_detection` is null and
// `server_vad`/`semantic_vad` are unsupported — never configure them.
// `gpt-live-transcribe` returns no word timestamps, speaker labels,
// confidence scores or detected languages. Recorded fixtures only: no live
// provider call in tests or CI.
import type {
  SpeechAudioFormat,
  SpeechBinding,
  SpeechEngineIdentity,
  SpeechEvent,
  SpeechEventMetadata,
  SpeechInputFrame,
  SpeechSession,
  SpeechSessionReceipt,
  SpeechSessionRequest,
  SpeechTranscriptFinal,
  SpeechTranscriptPartial,
} from './contracts.js';
import { isValidSpeechAudioFrame } from './contracts.js';
import type { SpeechCapabilities } from './capabilities.js';

export const OPENAI_TRANSCRIPTION_PROVIDER_ID = 'openai';
export const OPENAI_TRANSCRIPTION_ADAPTER_ID = 'openai-transcription';
export const OPENAI_TRANSCRIPTION_ADAPTER_REVISION = '1';
export const OPENAI_TRANSCRIPTION_PLACEMENT = 'cloud-relay' as const;
export const OPENAI_TRANSCRIPTION_WS_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

export const openAiTranscriptionModels = ['gpt-live-transcribe', 'gpt-realtime-whisper'] as const;
export type OpenAiTranscriptionModelId = (typeof openAiTranscriptionModels)[number];

export const openAiTranscriptionDelays = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type OpenAiTranscriptionDelay = (typeof openAiTranscriptionDelays)[number];

/** Independent per-profile configuration. No shared mutable state between profiles. */
export interface OpenAiTranscriptionProfileConfig {
  readonly modelId: OpenAiTranscriptionModelId;
  /** Served model snapshot pinned at admission; never an unreviewed `latest` alias. */
  readonly modelRevision: string;
  /** Latency/accuracy tradeoff; per-profile, never inherited. */
  readonly delay: OpenAiTranscriptionDelay;
  readonly language?: string;
  readonly prompt?: string;
  /** Client-owned turn detection only. Any other value refuses at open. */
  readonly turnDetection?: 'client';
  readonly accountRef?: string;
  readonly region?: string;
}

const TRANSCRIPTION_FORMAT: SpeechAudioFormat = { codec: 'pcm16-le', sampleRateHz: 24000, channels: 1 };

export const openAiTranscriptionIdentity = (
  config: OpenAiTranscriptionProfileConfig,
): SpeechEngineIdentity => ({
  providerId: OPENAI_TRANSCRIPTION_PROVIDER_ID,
  modelId: config.modelId,
  modelRevision: config.modelRevision,
  adapterId: OPENAI_TRANSCRIPTION_ADAPTER_ID,
  adapterRevision: OPENAI_TRANSCRIPTION_ADAPTER_REVISION,
  placement: OPENAI_TRANSCRIPTION_PLACEMENT,
});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** Per-profile capabilities. TTS is unsupported: synthesis is selected separately (local or L13). */
export const openAiTranscriptionCapabilities = (
  config: OpenAiTranscriptionProfileConfig,
): SpeechCapabilities => {
  if (!openAiTranscriptionModels.includes(config.modelId)) {
    throw new OpenAiTranscriptionError('unknown-model', `unknown OpenAI transcription model: ${String(config.modelId)}`);
  }
  if (!isNonEmptyString(config.modelRevision)) {
    throw new OpenAiTranscriptionError('invalid-config', 'modelRevision must be a pinned non-empty revision');
  }
  if (!openAiTranscriptionDelays.includes(config.delay)) {
    throw new OpenAiTranscriptionError('invalid-config', `delay must be one of ${openAiTranscriptionDelays.join(', ')}`);
  }
  if (config.turnDetection !== undefined && config.turnDetection !== 'client') {
    throw new OpenAiTranscriptionError('invalid-config', 'only client turn detection is supported for this profile');
  }
  return {
    binding: openAiTranscriptionIdentity(config),
    ...(config.language ? { languages: [config.language] } : {}),
    ...(config.region ? { regions: [config.region] } : {}),
    features: {
      streamingStt: 'supported',
      partialTranscript: 'supported',
      nativeDuplex: 'unsupported',
      tts: 'unsupported',
      serverVad: 'unsupported',
      clientVad: 'supported',
      manualCommit: 'supported',
      playoutTruncate: 'unsupported',
      toolCancellation: 'unsupported',
      resume: 'unknown',
    },
    inputFormats: [TRANSCRIPTION_FORMAT],
    outputFormats: [],
    usageUnits: ['audio-seconds', 'session-seconds'],
  };
};

/** Exact `session.update` body. `turn_detection` is always null (server VAD unsupported). */
export const buildTranscriptionSessionUpdate = (
  config: OpenAiTranscriptionProfileConfig,
): Record<string, unknown> => {
  // Reuse the capability gate so the wire can never carry an unvalidated profile.
  openAiTranscriptionCapabilities(config);
  return {
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: TRANSCRIPTION_FORMAT.sampleRateHz },
          transcription: {
            model: config.modelId,
            delay: config.delay,
            ...(config.language ? { language: config.language } : {}),
            ...(config.prompt ? { prompt: config.prompt } : {}),
          },
          turn_detection: null,
        },
      },
    },
  };
};

export class OpenAiTranscriptionError extends Error {
  readonly code: 'unknown-model' | 'invalid-config' | 'admission' | 'ceiling' | 'closed'
    | 'aborted' | 'transport' | 'invalid-format' | 'unsupported-command';
  constructor(code: OpenAiTranscriptionError['code'], message: string) {
    super(message);
    this.name = 'OpenAiTranscriptionError';
    this.code = code;
  }
}

/** Portable base64 for PCM payloads (no node:buffer; mesh stays runtime-agnostic). */
const base64Of = (payload: Uint8Array): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < payload.length; i += 3) {
    const a = payload[i] ?? 0;
    const b = payload[i + 1] ?? 0;
    const c = payload[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    out += alphabet[(triple >> 18) & 63] + alphabet[(triple >> 12) & 63]
      + (i + 1 < payload.length ? alphabet[(triple >> 6) & 63] : '=')
      + (i + 2 < payload.length ? alphabet[triple & 63] : '=');
  }
  return out;
};
