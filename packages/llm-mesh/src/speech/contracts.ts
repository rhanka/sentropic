import type { SpeechCapabilities, SpeechCapabilityName } from './capabilities.js';

export const speechPlacements = [
  'endpoint-native', 'browser-wasm', 'local-companion', 'cluster-hosted', 'cloud-relay',
] as const;
export type SpeechPlacement = (typeof speechPlacements)[number];
export type SpeechPipeline = 'chained' | 'native-duplex';
export type SpeechMicMode = 'key' | 'open-mic';
export type SpeechStage = 'stt' | 'tts' | 'duplex';

/** Exact engine tuple, independent of the existing agent model/route. No secrets. */
export interface SpeechBinding {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly adapterId: string;
  readonly adapterRevision: string;
  readonly placement: SpeechPlacement;
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
