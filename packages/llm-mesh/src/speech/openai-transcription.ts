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

