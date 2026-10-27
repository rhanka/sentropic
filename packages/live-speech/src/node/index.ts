// Public node entry for @sentropic/live-speech (r3 L3).
export { selectLocalSttProfile, LOCAL_STT_PROFILES, UnknownSpeechProfileError } from './profiles.js';
export type { LocalSttProfile, LocalSttModelId, LocalSttModelPin } from './profiles.js';
export type { SttEnginePort, SttSegment, SttTranscription, SttTranscribeOptions } from './engine-port.js';
export { NodeWorkerClient, SessionClosedError } from './worker-port.js';
export type { NodeWorkerClientOptions, WorkerPort } from './worker-port.js';
export { ENGINE_VAD_ASSET, ModelDigestMismatchError, resolveModelDir, verifyModelDir } from './model-pins.js';
export { LocalSttSession } from './local-stt.js';
export type { LocalSttEvent, LocalSttSessionOptions } from './local-stt.js';
export { UtteranceBuffer, rmsDbfs } from './utterance-buffer.js';
export { HypothesisTracker, usableText } from './reconciler.js';
export type { ReconciledPartial } from './reconciler.js';
export {
  ArecordDevice,
  ARECORD_SHA256_PINS,
  buildArecordArgs,
  DeviceLostError,
  DeviceOpenError,
  DeviceUnavailableError,
  parseArecordList,
} from './device.js';
export type { AudioDeviceInfo, AudioStream, DevicePort, OpenDeviceOptions } from './device.js';
export { CaptureSession } from './capture.js';
export type { CaptureDiagnostics, CaptureFrame, CaptureSessionEvents, CaptureSessionOptions } from './capture.js';
export { ControlError, TerminalController } from './terminal-control.js';
export type {
  HoldSource,
  KeyInput,
  TerminalControlEvent,
  TerminalControllerOptions,
  TerminalKeyBindings,
  TerminalKeyMode,
} from './terminal-control.js';
export {
  ESPEAK_MAX_CHARS,
  ESPEAK_SHA256_PINS,
  EspeakNgEngine,
  TtsRegistry,
  TtsSynthesisError,
  TtsUnsupportedError,
  buildEspeakArgs,
} from './tts-registry.js';
export type {
  EspeakNgOptions,
  EspeakRunner,
  TtsAudio,
  TtsCapabilities,
  TtsEngineName,
  TtsEnginePort,
  TtsRegistryOptions,
  TtsSynthesizeOptions,
} from './tts-registry.js';
export {
  APLAY_SHA256_PINS,
  AplayPlayback,
  PLAYBACK_MAX_WAV_BYTES,
  PlaybackCancelledError,
  PlaybackError,
  buildAplayArgs,
} from './playback.js';
export type { PlaybackPort } from './playback.js';
export {
  DEFAULT_MAX_NARRATION_CHARS,
  VoiceLoop,
  VoiceLoopBusyError,
  VoiceLoopClosedError,
  VoiceLoopRefusedError,
  boundNarration,
} from './voice-loop.js';
export type {
  BargeSource,
  VoiceLoopDiagnostics,
  VoiceLoopEvent,
  VoiceLoopOptions,
  VoiceLoopResult,
} from './voice-loop.js';
