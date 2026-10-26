// Engine port for local speech-to-text (r3 L3). The adapter depends on this interface,
// never on the owned faster-whisper package directly, so unit tests inject fakes and no
// native code loads outside the isolated worker.

/** One decoded segment of an utterance window. Times are seconds relative to the window start. */
export interface SttSegment {
  readonly startSec: number;
  readonly endSec: number;
  readonly text: string;
  /** 0..1; high values mean likely silence (engine VAD hint for the commit policy). */
  readonly noSpeechProb: number;
}

export interface SttTranscription {
  readonly segments: readonly SttSegment[];
  readonly language?: string;
}

export interface SttTranscribeOptions {
  readonly sampleRateHz: number;
  readonly language?: string;
}

/**
 * Transcribe one PCM window. Implementations must be callable off the event loop
 * (the session runs them inside the isolated worker) and must never retain audio.
 */
export interface SttEnginePort {
  readonly engineId: string;
  transcribe(window: Float32Array, options: SttTranscribeOptions): Promise<SttTranscription>;
  close(): Promise<void>;
}
