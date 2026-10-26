import type { SpeechCapabilities, SpeechCapabilityName } from './capabilities.js';

export const speechPlacements = [
  'endpoint-native', 'browser-wasm', 'local-companion', 'cluster-hosted', 'cloud-relay',
] as const;
export type SpeechPlacement = (typeof speechPlacements)[number];
export type SpeechPipeline = 'chained' | 'native-duplex';
export type SpeechMicMode = 'key' | 'open-mic';
export type SpeechStage = 'stt' | 'tts' | 'duplex';

/** Exact engine tuple, independent of the existing agent model/route. No secrets. */
export interface SpeechEngineIdentity {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly placement: SpeechPlacement;
}

/** Session selectors are independent of the engine's catalogue identity. */
export interface SpeechBinding extends SpeechEngineIdentity {
  readonly language?: string;
  readonly voice?: string;
  readonly region?: string;
  readonly accountRef?: string;
  readonly resourceRef?: string;
}

export interface SpeechConfigurationReference {
  readonly profileId: string;
  readonly configRevision: string;
  readonly policyRef: string;
}

export interface SpeechTarget {
  readonly sessionId: string;
  readonly sourceGeneration: string;
  readonly controllerEpoch: number;
  readonly consentRevision: string;
}

export interface SpeechAudioFormat {
  readonly codec: 'pcm16-le' | 'opus';
  readonly sampleRateHz: 16000 | 24000 | 48000;
  readonly channels: 1;
}

/** Timestamps are comparable only within the named monotonic clock domain. */
export interface SpeechEventMetadata {
  readonly schemaVersion: 1;
  readonly speechSessionId: string;
  readonly connectionEpoch: number;
  readonly eventId: string;
  readonly sequence: number;
  readonly causalCommandId?: string;
  readonly clock: { readonly id: string; readonly monotonicMs: number };
}

interface SpeechAudioFrame extends SpeechEventMetadata {
  readonly streamId: string;
  readonly sampleCount: number;
  readonly format: SpeechAudioFormat;
  /** Binary media is transient; never persist it in control/usage event logs. */
  readonly payload: Uint8Array;
}

export interface SpeechInputFrame extends SpeechAudioFrame {
  readonly type: 'audio.input';
  readonly utteranceId: string;
  readonly capturedAtMs: number;
}

export interface SpeechOutputFrame extends SpeechAudioFrame {
  readonly type: 'audio.output';
  readonly responseId: string;
  readonly outputItemId: string;
  readonly turnId: string;
  readonly turnEpoch: number;
  readonly sampleOffset: number;
}

export interface SpeechPlaybackProgress extends SpeechEventMetadata {
  readonly type: 'playback.progress';
  readonly outputItemId: string;
  readonly playedSamples: number;
  readonly uncertaintySamples: number;
}

interface SpeechTranscriptBase extends SpeechEventMetadata {
  readonly binding: SpeechBinding;
  readonly utteranceId: string;
  readonly revision: number;
  readonly text: string;
}

export interface SpeechTranscriptPartial extends SpeechTranscriptBase {
  readonly type: 'transcript.partial';
  /** Replace a UTF-16 range of the previous hypothesis; display only. */
  readonly replaces: { readonly start: number; readonly end: number };
  readonly confidence?: number;
}

export interface SpeechTranscriptFinal extends SpeechTranscriptBase {
  readonly type: 'transcript.final';
  readonly audioInterval: { readonly startMs: number; readonly endMs: number };
  readonly language: string;
}

/** Finals are immutable; a correction is a separate user edit, never a new submission. */
export type SpeechTranscript = SpeechTranscriptPartial | SpeechTranscriptFinal;

export interface SpeechSessionRequest {
  readonly protocolVersion: 1;
  readonly configuration: SpeechConfigurationReference;
  readonly target: SpeechTarget;
  readonly pipeline: SpeechPipeline;
  readonly micMode: SpeechMicMode;
  readonly bindings: Readonly<Partial<Record<SpeechStage, SpeechBinding>>>;
  readonly requiredCapabilities: readonly SpeechCapabilityName[];
  readonly inputFormats: readonly SpeechAudioFormat[];
  readonly outputFormats: readonly SpeechAudioFormat[];
  readonly maxDurationMs: number;
  readonly maxCostUsd: number;
  readonly budgetRef: string;
  readonly allowedPlacements: readonly SpeechPlacement[];
  readonly egressPolicyRef: string;
}

/** Trusted admission pins the effective tuple before any audio is transmitted. */
export interface SpeechSessionReceipt {
  readonly protocolVersion: 1;
  readonly speechSessionId: string;
  readonly connectionEpoch: number;
  readonly configuration: SpeechConfigurationReference;
  readonly target: SpeechTarget;
  readonly pipeline: SpeechPipeline;
  readonly micMode: SpeechMicMode;
  readonly stages: Readonly<Partial<Record<SpeechStage, SpeechCapabilities>>>;
  readonly inputFormat?: SpeechAudioFormat;
  readonly outputFormat?: SpeechAudioFormat;
}

export type SpeechSessionState = 'opening' | 'ready' | 'closing' | 'closed' | 'failed';

export type SpeechCommand = SpeechEventMetadata & (
  | { readonly type: 'input.commit' | 'input.clear'; readonly utteranceId: string }
  | { readonly type: 'session.mute'; readonly muted: boolean }
  | { readonly type: 'session.close' }
  | { readonly type: 'playback.clear'; readonly turnEpoch: number }
  | { readonly type: 'response.cancel'; readonly responseId: string; readonly turnEpoch: number }
);

export type SpeechEvent = SpeechInputFrame | SpeechOutputFrame | SpeechTranscript | SpeechPlaybackProgress
  | (SpeechEventMetadata & (
    | { readonly type: 'vad.speech_started' | 'vad.speech_stopped'; readonly utteranceId: string;
        readonly audioOffsetMs: number; readonly detector: 'client' | 'server'; readonly confidence?: number }
    | { readonly type: 'audio.output_done'; readonly responseId: string; readonly outputItemId: string;
        readonly turnId: string; readonly turnEpoch: number }
    | { readonly type: 'provider.cancelled'; readonly responseId: string }
    | { readonly type: 'session.state'; readonly state: SpeechSessionState }
    | { readonly type: 'audio.gap'; readonly streamId: string; readonly startMs: number; readonly endMs: number }
    | { readonly type: 'session.degraded' | 'error'; readonly reason: string; readonly retryable: boolean }
  ));

/** Duplex provider port, not the agent-control authority. Writes must honor backpressure. */
export interface SpeechSession {
  readonly receipt: SpeechSessionReceipt;
  readonly events: AsyncIterable<SpeechEvent>;
  write(frame: SpeechInputFrame, signal?: AbortSignal): Promise<void>;
  command(command: SpeechCommand, signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

export interface SpeechAdapter {
  readonly capabilities: SpeechCapabilities;
  open(request: SpeechSessionRequest, signal: AbortSignal): Promise<SpeechSession>;
}

const nonnegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/** Validate frame-local metadata; epoch/order/queue enforcement belongs to L2. */
export const isValidSpeechAudioFrame = (frame: SpeechInputFrame | SpeechOutputFrame): boolean => {
  const { format } = frame;
  return frame.schemaVersion === 1 && Boolean(frame.speechSessionId && frame.eventId && frame.streamId)
    && nonnegativeInteger(frame.connectionEpoch) && nonnegativeInteger(frame.sequence)
    && Boolean(frame.clock.id) && Number.isFinite(frame.clock.monotonicMs) && frame.clock.monotonicMs >= 0
    && nonnegativeInteger(frame.sampleCount) && frame.sampleCount > 0
    && format.channels === 1 && [16000, 24000, 48000].includes(format.sampleRateHz)
    && frame.payload instanceof Uint8Array && frame.payload.byteLength > 0
    && (format.codec === 'pcm16-le' ? frame.payload.byteLength === frame.sampleCount * 2 : format.codec === 'opus')
    && (frame.type === 'audio.input'
      ? Boolean(frame.utteranceId) && Number.isFinite(frame.capturedAtMs) && frame.capturedAtMs >= 0
      : frame.type === 'audio.output' && Boolean(frame.responseId && frame.outputItemId && frame.turnId)
        && nonnegativeInteger(frame.turnEpoch) && nonnegativeInteger(frame.sampleOffset));
};
