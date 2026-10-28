// Mistral streaming STT (L13): `mistral-voxtral-realtime-3` behind the mesh
// speech contract, plus the Mistral TTS binding/registry entry. Wire facts are
// grounded in the Mistral Studio audio docs [O8]
// (https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-in-realtime
// and https://docs.mistral.ai/studio/audio/text-to-speech/generate-speech,
// fetched 2026-10-28):
// realtime WebSocket
// `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-3`
// (model in the query, Bearer handshake), `session.created` (wait for it
// before anything else), `session.update` with a `session` object
// (audio_format pcm_s16le + sample rate, target_streaming_delay_ms,
// language), `session.updated` echo, PCM audio via `input_audio.append`,
// append-only `transcription.text.delta` finals (no correction), then
// `input_audio.end` and `transcription.done` with the transcript of record.
// `turn_detection` stays off: client commits drive turns. The 2602 models are
// deprecated and refused here; the 3.0 preview is pinned exactly.
// TTS is selection/binding only: `POST /v1/audio/speech` with model
// `voxtral-mini-tts-3-0`, voice_id and response_format. The mesh holds no
// synthesis transport; the HTTPS call happens at composition. Recorded
// fixtures only: no live provider call in tests or CI.
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

export const MISTRAL_TRANSCRIPTION_PROVIDER_ID = 'mistral';
export const MISTRAL_TRANSCRIPTION_ADAPTER_ID = 'mistral-transcription';
export const MISTRAL_TRANSCRIPTION_ADAPTER_REVISION = '1';
export const MISTRAL_TRANSCRIPTION_PLACEMENT = 'cloud-relay' as const;
export const MISTRAL_TRANSCRIPTION_MODEL_ID = 'voxtral-mini-transcribe-realtime-3';
export const MISTRAL_TRANSCRIPTION_WS_URL =
  'wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-3';

/** The only STT model this adapter serves. The 2602 generation is refused. */
export const mistralTranscriptionModels = ['voxtral-mini-transcribe-realtime-3'] as const;
export type MistralTranscriptionModelId = (typeof mistralTranscriptionModels)[number];

/**
 * Trade speed for accuracy per session. Bounds follow the docs: 80 to 1200,
 * or exactly 2400. No implicit default: the profile pins one.
 */
export const MISTRAL_TRANSCRIPTION_DELAY_MIN_MS = 80;
export const MISTRAL_TRANSCRIPTION_DELAY_MAX_MS = 1200;
export const MISTRAL_TRANSCRIPTION_DELAY_SLOW_MS = 2400;

/** Independent per-profile configuration. No shared mutable state between profiles. */
export interface MistralTranscriptionProfileConfig {
  readonly modelId: MistralTranscriptionModelId;
  /** Served model snapshot pinned at admission; never an unreviewed `latest` alias. */
  readonly modelRevision: string;
  /** Wait in ms trading speed for accuracy (80-1200, or exactly 2400). */
  readonly targetStreamingDelayMs: number;
  /** Two-letter ISO 639-1 code. Unset lets the model detect the language. */
  readonly language?: string;
  /** Client-owned turn detection only. Any other value refuses at open. */
  readonly turnDetection?: 'client';
  readonly accountRef?: string;
}

const TRANSCRIPTION_FORMAT: SpeechAudioFormat = { codec: 'pcm16-le', sampleRateHz: 24000, channels: 1 };

export const mistralTranscriptionIdentity = (
  config: MistralTranscriptionProfileConfig,
): SpeechEngineIdentity => ({
  providerId: MISTRAL_TRANSCRIPTION_PROVIDER_ID,
  modelId: config.modelId,
  modelRevision: config.modelRevision,
  adapterId: MISTRAL_TRANSCRIPTION_ADAPTER_ID,
  adapterRevision: MISTRAL_TRANSCRIPTION_ADAPTER_REVISION,
  placement: MISTRAL_TRANSCRIPTION_PLACEMENT,
});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isDelayMs = (value: unknown): value is number =>
  Number.isSafeInteger(value) && ((value >= MISTRAL_TRANSCRIPTION_DELAY_MIN_MS
    && value <= MISTRAL_TRANSCRIPTION_DELAY_MAX_MS) || value === MISTRAL_TRANSCRIPTION_DELAY_SLOW_MS);

const isLanguageCode = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z]{2}$/u.test(value);

/** Per-profile STT capabilities. TTS is unsupported: synthesis is selected separately. */
export const mistralTranscriptionCapabilities = (
  config: MistralTranscriptionProfileConfig,
): SpeechCapabilities => {
  if (!mistralTranscriptionModels.includes(config.modelId)) {
    throw new MistralTranscriptionError('unknown-model',
      `unknown Mistral transcription model: ${String(config.modelId)} (2602 models are not served here)`);
  }
  if (!isNonEmptyString(config.modelRevision)) {
    throw new MistralTranscriptionError('invalid-config', 'modelRevision must be a pinned non-empty revision');
  }
  if (!isDelayMs(config.targetStreamingDelayMs)) {
    throw new MistralTranscriptionError('invalid-config',
      `targetStreamingDelayMs must be 80-1200 or exactly 2400, got ${String(config.targetStreamingDelayMs)}`);
  }
  if (config.language !== undefined && !isLanguageCode(config.language)) {
    throw new MistralTranscriptionError('invalid-config',
      `language must be a two-letter ISO 639-1 code, got ${String(config.language)}`);
  }
  if (config.turnDetection !== undefined && config.turnDetection !== 'client') {
    throw new MistralTranscriptionError('invalid-config', 'only client turn detection is supported for this profile');
  }
  return {
    binding: mistralTranscriptionIdentity(config),
    ...(config.language ? { languages: [config.language] } : {}),
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

/**
 * Exact `session.update` body. `turn_detection` is omitted (server turn
 * detection unsupported); the provider fixes settings at the first audio.
 */
export const buildMistralSessionUpdate = (
  config: MistralTranscriptionProfileConfig,
): Record<string, unknown> => {
  // Reuse the capability gate so the wire can never carry an unvalidated profile.
  mistralTranscriptionCapabilities(config);
  return {
    type: 'session.update',
    session: {
      audio_format: { encoding: 'pcm_s16le', sample_rate: TRANSCRIPTION_FORMAT.sampleRateHz },
      target_streaming_delay_ms: config.targetStreamingDelayMs,
      ...(config.language ? { language: config.language } : {}),
    },
  };
};

export class MistralTranscriptionError extends Error {
  readonly code: 'unknown-model' | 'invalid-config' | 'admission' | 'ceiling' | 'closed'
    | 'aborted' | 'transport' | 'invalid-format' | 'unsupported-command';
  constructor(code: MistralTranscriptionError['code'], message: string) {
    super(message);
    this.name = 'MistralTranscriptionError';
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

