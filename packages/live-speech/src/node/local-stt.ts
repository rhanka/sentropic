// Local STT session (r3 L3): rolling windows, energy-gated endpointing and stable-prefix
// reconciliation over an injected worker port. The event loop never blocks: decoding
// runs in the isolated worker; this module only moves PCM and hypotheses.
// Audio never leaves in events or logs — only counts, revisions and text do.
import type { LocalSttProfile } from './profiles.js';
import type { SttTranscription } from './engine-port.js';
import { SessionClosedError, type WorkerPort } from './worker-port.js';
import { rmsDbfs, UtteranceBuffer } from './utterance-buffer.js';
import { HypothesisTracker, usableText } from './reconciler.js';

export type LocalSttEvent =
  | { type: 'partial'; utteranceId: string; revision: number; text: string; replaces: { start: number; end: number } }
  | { type: 'final'; utteranceId: string; text: string }
  | { type: 'error'; message: string };

export interface LocalSttSessionOptions {
  readonly profile: LocalSttProfile;
  readonly port: WorkerPort;
  readonly emit: (event: LocalSttEvent) => void;
  readonly language?: string;
  /**
   * Backpressure bound: at most this many window decodes in flight (default 1).
   * A cadence tick that lands above the bound is skipped and retried on the next
   * push, so the queue behind the endpoint decode stays bounded and the final
   * never starves behind stale windows.
   */
  readonly maxInflightWindows?: number;
}

const MIN_UTTERANCE_MS = 150;

/**
 * One local transcription session. Sample counts drive every decision (deterministic;
 * no wall clock anywhere). Exactly one final per utterance that carries usable
 * recognition; late or duplicate worker results are ignored; close() settles
 * everything without starving or retaining audio.
 */
export class LocalSttSession {
  private readonly profile: LocalSttProfile;
  private readonly port: WorkerPort;
  private readonly emitEvent: (event: LocalSttEvent) => void;
  private readonly language?: string;
  private readonly buffer = new UtteranceBuffer();
  private readonly tracker = new HypothesisTracker();
  private closed = false;
  private utteranceFinalEmitted = false;
  private windowsInFlight = 0;
  private readonly maxInflight: number;

  constructor(options: LocalSttSessionOptions) {
    this.profile = options.profile;
    this.port = options.port;
    this.emitEvent = options.emit;
    this.language = options.language;
    this.maxInflight = Math.max(1, Math.floor(options.maxInflightWindows ?? 1));
  }

  diagnostics(): { closed: boolean; utteranceOpen: boolean; bufferedSamples: number; retainedSamples: number } {
    return {
      closed: this.closed,
      utteranceOpen: this.buffer.utteranceOpen,
      bufferedSamples: this.buffer.bufferedSamples,
      retainedSamples: this.buffer.retainedSamples,
    };
  }

  pushFrames(pcm: Float32Array): void {
    if (this.closed) throw new SessionClosedError();
    if (pcm.length === 0) return;
    const rate = this.profile.sampleRateHz;
    if (rmsDbfs(pcm) > this.profile.energyThresholdDb) {
      if (!this.buffer.utteranceOpen) this.openUtterance();
      this.buffer.push(pcm, true);
    } else if (this.buffer.utteranceOpen) {
      this.buffer.push(pcm, false);
    }
    if (this.buffer.utteranceOpen) {
      const cadenceSamples = Math.floor(this.profile.decodeCadenceSec * rate);
      if (this.buffer.samplesSinceDecode >= cadenceSamples && this.decodeWindow()) {
        this.buffer.markDecoded();
      }
      const hangoverSamples = Math.floor((this.profile.silenceHangoverMs / 1000) * rate);
      if (this.buffer.silenceSamples >= hangoverSamples) void this.endpointUtterance();
      // Forced endpoint: an utterance never accumulates past maxUtteranceSec, so a
      // noisy open mic cannot grow the buffer (and the final wait) without bound.
      const maxSamples = Math.floor(this.profile.maxUtteranceSec * rate);
      if (this.buffer.bufferedSamples >= maxSamples) void this.endpointUtterance();
    }
  }

  private openUtterance(): void {
    this.buffer.openUtterance();
    this.tracker.reset();
    this.utteranceFinalEmitted = false;
  }

  private abandonUtterance(): void {
    this.buffer.abandon();
    this.tracker.reset();
  }

  /**
   * Decode one rolling window. At most maxInflight window decodes are ever in
   * flight: a cadence tick that lands above the bound is skipped (the dispatch
   * returns false and the sample counter is left running, so the next push
   * retries immediately). The queue behind the endpoint decode therefore stays
   * bounded, and the final never starves behind stale windows.
   * Returns true when a decode was dispatched.
   */
  private decodeWindow(): boolean {
    const utterance = this.buffer.utteranceId;
    if (utterance === null || this.closed || this.windowsInFlight >= this.maxInflight) return false;
    const { window, endSample } = this.buffer.window(this.profile, this.tracker.committedEndSample);
    if (window.length === 0) return false;
    this.windowsInFlight += 1;
    void this.runWindowDecode(utterance, window, endSample);
    return true;
  }

  private async runWindowDecode(utterance: string, window: Float32Array, endSample: number): Promise<void> {
    try {
      let transcription: SttTranscription;
      try {
        transcription = await this.port.transcribe(window, { sampleRateHz: this.profile.sampleRateHz, language: this.language });
      } catch (error) {
        if (this.closed || this.buffer.utteranceId !== utterance) return;
        this.emitEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        this.abandonUtterance();
        return;
      }
      // A window decode that resolves after its utterance closed or moved on (endpoint
      // abandons accumulation synchronously) is superseded by the authoritative endpoint
      // decode — applied at most once, never duplicated.
      if (this.closed || this.buffer.utteranceId !== utterance) return;
      const partial = this.tracker.applyWindow(endSample, usableText(transcription));
      if (partial === null) return;
      this.emitEvent({ type: 'partial', utteranceId: utterance, ...partial });
    } finally {
      this.windowsInFlight = Math.max(0, this.windowsInFlight - 1);
    }
  }

  /**
   * Endpoint an utterance: snapshot its audio and free accumulation immediately so
   * following speech opens a new utterance, then decode the snapshot exactly once.
   * A final is never synthesized from silence or unusable recognition.
   */
  private async endpointUtterance(): Promise<void> {
    const utterance = this.buffer.utteranceId;
    if (utterance === null || this.utteranceFinalEmitted) return;
    const { audio, totalSamples } = this.buffer.snapshot();
    this.utteranceFinalEmitted = true;
    this.abandonUtterance();
    if (audio.length === 0) return;
    let transcription: SttTranscription;
    try {
      transcription = await this.port.transcribe(audio, { sampleRateHz: this.profile.sampleRateHz, language: this.language });
    } catch (error) {
      if (this.closed) return;
      this.emitEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (this.closed) return;
    const text = usableText(transcription);
    const minSamples = Math.floor((MIN_UTTERANCE_MS / 1000) * this.profile.sampleRateHz);
    if (text === null || totalSamples < minSamples) return;
    this.emitEvent({ type: 'final', utteranceId: utterance, text });
  }

  /** Terminate the worker and release every buffer. Pending decodes settle without emitting. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abandonUtterance();
    this.port.terminate();
  }
}
