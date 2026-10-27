// Shared voice loop (r3 L6a). One narration at a time: bounded text in,
// one synthesis, one playback, barge-in out. The loop owns no STT session and
// no L2 journal: callers wire capture VAD (`barge('vad')`) and control keys
// (`stop()`), and the L3 worker port stays injected so the engine seam stays
// open for a second engine. Audio is never retained: the WAV lives in one
// local through playback, and events carry narration ids, counts and text
// only (never PCM or file bytes).
import type { SpeechMicMode } from '../../../llm-mesh/src/speech/contracts.js';
import type { TtsEnginePort } from './tts-registry.js';
import type { PlaybackPort } from './playback.js';

export type BargeSource = 'vad' | 'key' | 'stop';

export type VoiceLoopEvent =
  | { readonly type: 'narration-start'; readonly narrationId: string; readonly chars: number }
  | { readonly type: 'narration-played'; readonly narrationId: string; readonly chars: number }
  | { readonly type: 'narration-cancelled'; readonly narrationId: string; readonly source: BargeSource }
  | { readonly type: 'tts-error'; readonly narrationId: string; readonly message: string }
  | { readonly type: 'playback-error'; readonly narrationId: string; readonly message: string };

export interface VoiceLoopResult {
  readonly status: 'played' | 'cancelled';
  readonly narrationId: string;
  readonly chars: number;
}

export interface VoiceLoopOptions {
  readonly tts: TtsEnginePort;
  readonly playback: PlaybackPort;
  readonly emit: (event: VoiceLoopEvent) => void;
  /** Explicit session choice, driven by the L1c profile micMode. Starts 'key'. */
  readonly micMode?: SpeechMicMode;
  /** Narration bound: longer text is cut at a clause boundary, never mid-word. */
  readonly maxNarrationChars?: number;
  readonly voice?: string;
}

export interface VoiceLoopDiagnostics {
  readonly speaking: boolean;
  readonly closed: boolean;
  readonly micMode: SpeechMicMode;
  readonly micOn: boolean;
  readonly muted: boolean;
  readonly played: number;
  readonly cancelled: number;
}

export class VoiceLoopClosedError extends Error {
  readonly code = 'voice_loop_closed';
  constructor() {
    super('Voice loop is closed');
    this.name = 'VoiceLoopClosedError';
  }
}

export class VoiceLoopBusyError extends Error {
  readonly code = 'voice_loop_busy';
  constructor() {
    super('Voice loop is already speaking (barge or wait first)');
    this.name = 'VoiceLoopBusyError';
  }
}

export class VoiceLoopRefusedError extends Error {
  readonly code = 'voice_loop_refused';
  constructor(message: string) {
    super(`Voice loop refused narration: ${message}`);
    this.name = 'VoiceLoopRefusedError';
  }
}

/** Default narration bound (spec §9 clause cadence is 120 chars per chunk). */
export const DEFAULT_MAX_NARRATION_CHARS = 480;

/**
 * Cut narration at a clause boundary within the bound (pure, unit-tested).
 * Hard-cuts only when no boundary fits; empty input stays empty.
 */
export function boundNarration(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const head = trimmed.slice(0, maxChars);
  const boundaries = ['. ', '! ', '? ', '; ', ': ', ', ', '\n'];
  let cut = -1;
  for (const boundary of boundaries) {
    const index = head.lastIndexOf(boundary);
    if (index > cut) cut = index + boundary.length;
  }
  if (cut <= 0) return head;
  return head.slice(0, cut).trimEnd();
}

let narrationCounter = 0;

/**
 * One-at-a-time narration with fence barge-in. Synthesis is short and bounded
 * (uninterruptible); playback is the cancellable phase. A barge that lands
 * during synthesis skips playback and reports cancelled.
 */
export class VoiceLoop {
  private readonly tts: TtsEnginePort;
  private readonly playback: PlaybackPort;
  private readonly emitEvent: (event: VoiceLoopEvent) => void;
  private readonly maxNarrationChars: number;
  private readonly voice?: string;
  private micMode: SpeechMicMode;
  private micOn = false;
  private muted = false;
  private speaking: string | null = null;
  private bargePending: BargeSource | null = null;
  private closed = false;
  private played = 0;
  private cancelled = 0;

  constructor(options: VoiceLoopOptions) {
    this.tts = options.tts;
    this.playback = options.playback;
    this.emitEvent = options.emit;
    this.micMode = options.micMode ?? 'key';
    this.maxNarrationChars = options.maxNarrationChars ?? DEFAULT_MAX_NARRATION_CHARS;
    this.voice = options.voice;
  }

  diagnostics(): VoiceLoopDiagnostics {
    return {
      speaking: this.speaking !== null,
      closed: this.closed,
      micMode: this.micMode,
      micOn: this.micOn,
      muted: this.muted,
      played: this.played,
      cancelled: this.cancelled,
    };
  }

  setMicOn(on: boolean): void {
    this.micOn = on;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  setMicMode(mode: SpeechMicMode): void {
    this.micMode = mode;
  }

  /**
   * Barge in: cancel the current narration within the fence (the playback
   * cancel is invoked synchronously, before this call returns). VAD barge-in
   * is gated by the mic mode: open-mic always listens (unless muted), key
   * mode only while the mic is on. Stop always wins.
   */
  barge(source: BargeSource): void {
    if (source === 'vad') {
      if (this.muted) return;
      if (this.micMode === 'key' && !this.micOn) return;
    }
    if (this.speaking === null) return;
    this.bargePending = source;
    this.playback.cancel();
  }

  /** Terminal stop: cancel the narration and close the loop. Idempotent. */
  async stop(): Promise<void> {
    this.barge('stop');
    await this.close();
  }

  async speak(text: string): Promise<VoiceLoopResult> {
    if (this.closed) throw new VoiceLoopClosedError();
    if (this.speaking !== null) throw new VoiceLoopBusyError();
    const narrationId = `n${++narrationCounter}`;
    const bounded = boundNarration(text, this.maxNarrationChars);
    if (bounded.length === 0) throw new VoiceLoopRefusedError('empty narration');
    this.speaking = narrationId;
    this.bargePending = null;
    this.emitEvent({ type: 'narration-start', narrationId, chars: bounded.length });
    let wav: Buffer | null = null;
    try {
      try {
        const audio = await this.tts.synthesize(bounded, { voice: this.voice });
        wav = audio.wav;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.speaking = null;
        this.emitEvent({ type: 'tts-error', narrationId, message });
        throw error;
      }
      const cancelledDuringSynth = this.bargePending;
      if (cancelledDuringSynth !== null) {
        return this.finishCancelled(narrationId, bounded.length, cancelledDuringSynth);
      }
      try {
        await this.playback.play(wav);
      } catch (error) {
        const pending = this.bargePending;
        if (pending !== null) return this.finishCancelled(narrationId, bounded.length, pending);
        const message = error instanceof Error ? error.message : String(error);
        this.speaking = null;
        this.emitEvent({ type: 'playback-error', narrationId, message });
        throw error;
      }
      if (this.bargePending !== null) {
        return this.finishCancelled(narrationId, bounded.length, this.bargePending);
      }
      this.speaking = null;
      this.played += 1;
      this.emitEvent({ type: 'narration-played', narrationId, chars: bounded.length });
      return { status: 'played', narrationId, chars: bounded.length };
    } finally {
      wav = null;
      if (this.speaking === narrationId) this.speaking = null;
    }
  }

  private finishCancelled(narrationId: string, chars: number, source: BargeSource): VoiceLoopResult {
    this.speaking = null;
    this.bargePending = null;
    this.cancelled += 1;
    this.emitEvent({ type: 'narration-cancelled', narrationId, source });
    return { status: 'cancelled', narrationId, chars };
  }

  /** Cancel the narration and release engine and playback. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.playback.cancel();
    this.playback.close();
    await this.tts.close();
    this.speaking = null;
  }
}
