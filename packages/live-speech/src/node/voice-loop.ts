// Shared voice loop (r3 L6a). One narration at a time, rendered in short
// clause chunks (spec §9 clause cadence): bounded text in, one synthesis per
// chunk, one playback per chunk, barge-in out. The loop owns no STT session
// and no L2 journal: callers wire capture VAD (`barge('vad')`) and control
// keys (`stop()`, toggle barge), and the L3 worker port stays injected so the
// engine seam stays open for a second engine. Audio is never retained: each
// chunk WAV lives in one RAM buffer through playback, and events carry
// narration ids, counts and text length only (never PCM or file bytes).
import type { SpeechMicMode } from '../../../llm-mesh/src/speech/contracts.js';
import type { TtsEnginePort } from './tts-registry.js';
import type { PlaybackPort } from './playback.js';

export type BargeSource = 'vad' | 'key' | 'stop';

export type VoiceLoopEvent =
  | { readonly type: 'narration-start'; readonly narrationId: string; readonly chars: number; readonly chunks: number; readonly truncated: boolean; readonly turnEpoch?: number; readonly submitKey?: string }
  | { readonly type: 'narration-chunk'; readonly narrationId: string; readonly index: number; readonly chars: number }
  | { readonly type: 'narration-played'; readonly narrationId: string; readonly chars: number; readonly chunks: number; readonly truncated: boolean }
  | { readonly type: 'narration-cancelled'; readonly narrationId: string; readonly source: BargeSource; readonly chunks: number; readonly truncated: boolean }
  | { readonly type: 'tts-error'; readonly narrationId: string; readonly message: string }
  | { readonly type: 'playback-error'; readonly narrationId: string; readonly message: string };

export interface VoiceLoopResult {
  readonly status: 'played' | 'cancelled';
  readonly narrationId: string;
  readonly chars: number;
  readonly chunks: number;
  readonly truncated: boolean;
}

export interface VoiceLoopOptions {
  readonly tts: TtsEnginePort;
  readonly playback: PlaybackPort;
  readonly emit: (event: VoiceLoopEvent) => void;
  /** Explicit session choice, driven by the L1c profile micMode. Starts 'key'. */
  readonly micMode?: SpeechMicMode;
  /** Narration bound: longer text is cut at a clause boundary with truncated=true. */
  readonly maxNarrationChars?: number;
  /** Chunk bound: spec §9 clause cadence flushes at 120 chars per chunk. */
  readonly maxChunkChars?: number;
  readonly voice?: string;
  readonly speedWpm?: number;
  /** Caller-owned sensitivity policy: matching narration is refused unplayed. */
  readonly sensitivePatterns?: readonly RegExp[];
}

export interface SpeakOptions {
  /** L2 turn epoch carried through events; older epochs are refused (L2 fence seam). */
  readonly turnEpoch?: number;
  readonly submitKey?: string;
}

export interface VoiceLoopDiagnostics {
  readonly speaking: boolean;
  readonly closed: boolean;
  readonly micMode: SpeechMicMode;
  readonly micOn: boolean;
  readonly muted: boolean;
  readonly played: number;
  readonly cancelled: number;
  /** Highest turn epoch seen; null until the first epoch-tagged narration. */
  readonly epoch: number | null;
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

/** Default narration bound (a few §9 clause chunks). */
export const DEFAULT_MAX_NARRATION_CHARS = 480;

/** Default chunk bound (spec §9 clause cadence: 120 chars per chunk). */
export const DEFAULT_MAX_CHUNK_CHARS = 120;

/** Clause boundaries, longest match wins. */
const CLAUSE_BOUNDARIES = ['. ', '! ', '? ', '; ', ': ', ', ', '\n'];

function clauseCut(head: string): number {
  let cut = -1;
  for (const boundary of CLAUSE_BOUNDARIES) {
    const index = head.lastIndexOf(boundary);
    if (index > cut) cut = index + boundary.length;
  }
  return cut;
}

/**
 * Cut narration at a clause boundary within the bound (pure, unit-tested).
 * Hard-cuts only when no boundary fits; empty input stays empty.
 */
export function boundNarration(text: string, maxChars: number): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return { text: trimmed, truncated: false };
  const head = trimmed.slice(0, maxChars);
  const cut = clauseCut(head);
  if (cut <= 0) return { text: head, truncated: true };
  return { text: head.slice(0, cut).trimEnd(), truncated: true };
}

/**
 * Split bounded narration into clause chunks of at most maxChunkChars (pure,
 * unit-tested). Each chunk is submitted to synthesis exactly once, in order.
 */
export function chunkNarration(text: string, maxChunkChars: number): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > maxChunkChars) {
    const head = rest.slice(0, maxChunkChars);
    const cut = clauseCut(head);
    if (cut <= 0) {
      chunks.push(head);
      rest = rest.slice(maxChunkChars).trimStart();
    } else {
      chunks.push(head.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/**
 * One-at-a-time narration with fence barge-in. Chunks are short and bounded;
 * playback is the cancellable phase, and a barge that lands anywhere — during
 * synthesis, between chunks, or mid-play — stops the narration without
 * resubmitting it. A barge during synthesis aborts the espeak child, so stop
 * latency never includes synthesis time.
 */
export class VoiceLoop {
  private readonly tts: TtsEnginePort;
  private readonly playback: PlaybackPort;
  private readonly emitEvent: (event: VoiceLoopEvent) => void;
  private readonly maxNarrationChars: number;
  private readonly maxChunkChars: number;
  private readonly voice?: string;
  private readonly speedWpm?: number;
  private readonly sensitivePatterns: readonly RegExp[];
  private micMode: SpeechMicMode;
  private micOn = false;
  private muted = false;
  private speaking: string | null = null;
  private narrationAbort: AbortController | null = null;
  private bargePending: BargeSource | null = null;
  private closed = false;
  private played = 0;
  private cancelled = 0;
  private maxSeenEpoch: number | null = null;

  constructor(options: VoiceLoopOptions) {
    this.tts = options.tts;
    this.playback = options.playback;
    this.emitEvent = options.emit;
    this.micMode = options.micMode ?? 'key';
    this.maxNarrationChars = options.maxNarrationChars ?? DEFAULT_MAX_NARRATION_CHARS;
    this.maxChunkChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
    this.voice = options.voice;
    this.speedWpm = options.speedWpm;
    this.sensitivePatterns = options.sensitivePatterns ?? [];
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
      epoch: this.maxSeenEpoch,
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
   * cancel and the synth abort fire synchronously, before this call returns).
   * VAD barge-in is gated by the mic mode: open-mic always listens (unless
   * muted), key mode only while the mic is on. Stop always wins.
   */
  barge(source: BargeSource): void {
    if (source === 'vad') {
      if (this.muted) return;
      if (this.micMode === 'key' && !this.micOn) return;
    }
    if (this.speaking === null) return;
    this.bargePending = source;
    this.narrationAbort?.abort();
    this.playback.cancel();
  }

  /** Terminal stop: cancel the narration and close the loop. Idempotent. */
  async stop(): Promise<void> {
    this.barge('stop');
    await this.close();
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<VoiceLoopResult> {
    if (this.closed) throw new VoiceLoopClosedError();
    if (this.speaking !== null) throw new VoiceLoopBusyError();
    if (options.turnEpoch !== undefined) {
      if (this.maxSeenEpoch !== null && options.turnEpoch < this.maxSeenEpoch) {
        throw new VoiceLoopRefusedError(`stale turn epoch ${options.turnEpoch} (latest ${this.maxSeenEpoch})`);
      }
      this.maxSeenEpoch = Math.max(this.maxSeenEpoch ?? options.turnEpoch, options.turnEpoch);
    }
    const narrationId = `n${++narrationCounter}`;
    const bounded = boundNarration(text, this.maxNarrationChars);
    if (bounded.text.length === 0) throw new VoiceLoopRefusedError('empty narration');
    for (const pattern of this.sensitivePatterns) {
      if (pattern.test(bounded.text)) throw new VoiceLoopRefusedError('sensitive narration refused');
    }
    const chunks = chunkNarration(bounded.text, this.maxChunkChars);
    this.speaking = narrationId;
    this.bargePending = null;
    const aborter = new AbortController();
    this.narrationAbort = aborter;
    this.emitEvent({
      type: 'narration-start',
      narrationId,
      chars: bounded.text.length,
      chunks: chunks.length,
      truncated: bounded.truncated,
      ...(options.turnEpoch !== undefined ? { turnEpoch: options.turnEpoch } : {}),
      ...(options.submitKey !== undefined ? { submitKey: options.submitKey } : {}),
    });
    try {
      let playedChunks = 0;
      for (const chunk of chunks) {
        if (this.bargePending !== null) {
          return this.finishCancelled(narrationId, bounded, chunks.length, this.bargePending);
        }
        let wav: Buffer | null = null;
        try {
          const audio = await this.tts.synthesize(chunk, {
            voice: this.voice,
            speedWpm: this.speedWpm,
            signal: aborter.signal,
          });
          wav = audio.wav;
        } catch (error) {
          if (this.bargePending !== null) {
            return this.finishCancelled(narrationId, bounded, chunks.length, this.bargePending);
          }
          const message = error instanceof Error ? error.message : String(error);
          return this.finishError(narrationId, 'tts-error', message, error);
        }
        if (this.bargePending !== null) {
          return this.finishCancelled(narrationId, bounded, chunks.length, this.bargePending);
        }
        this.emitEvent({ type: 'narration-chunk', narrationId, index: playedChunks, chars: chunk.length });
        try {
          await this.playback.play(wav);
        } catch (error) {
          if (this.bargePending !== null) {
            return this.finishCancelled(narrationId, bounded, chunks.length, this.bargePending);
          }
          const message = error instanceof Error ? error.message : String(error);
          return this.finishError(narrationId, 'playback-error', message, error);
        } finally {
          wav = null;
        }
        if (this.bargePending !== null) {
          return this.finishCancelled(narrationId, bounded, chunks.length, this.bargePending);
        }
        playedChunks += 1;
      }
      this.speaking = null;
      this.bargePending = null;
      this.played += 1;
      this.emitEvent({
        type: 'narration-played',
        narrationId,
        chars: bounded.text.length,
        chunks: chunks.length,
        truncated: bounded.truncated,
      });
      return {
        status: 'played',
        narrationId,
        chars: bounded.text.length,
        chunks: chunks.length,
        truncated: bounded.truncated,
      };
    } finally {
      if (this.speaking === narrationId) this.speaking = null;
      if (this.narrationAbort === aborter) this.narrationAbort = null;
    }
  }

  private finishCancelled(
    narrationId: string,
    bounded: { text: string; truncated: boolean },
    chunks: number,
    source: BargeSource,
  ): VoiceLoopResult {
    this.speaking = null;
    this.bargePending = null;
    this.cancelled += 1;
    this.emitEvent({ type: 'narration-cancelled', narrationId, source, chunks, truncated: bounded.truncated });
    return { status: 'cancelled', narrationId, chars: bounded.text.length, chunks, truncated: bounded.truncated };
  }

  private finishError(
    narrationId: string,
    type: 'tts-error' | 'playback-error',
    message: string,
    original: unknown,
  ): never {
    this.speaking = null;
    this.emitEvent({ type, narrationId, message });
    throw original instanceof Error ? original : new Error(message);
  }

  /** Cancel the narration and release engine and playback. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    // A close during playback is a terminal stop, not a playback failure.
    if (this.speaking !== null && this.bargePending === null) {
      this.bargePending = 'stop';
      this.narrationAbort?.abort();
      this.playback.cancel();
    }
    this.closed = true;
    this.playback.close();
    await this.tts.close();
    this.speaking = null;
  }
}

let narrationCounter = 0;
