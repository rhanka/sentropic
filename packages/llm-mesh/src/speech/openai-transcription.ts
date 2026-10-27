// OpenAI streaming STT profiles (L9): `gpt-live-transcribe` and
// `gpt-realtime-whisper` behind the mesh speech contract. Wire facts are
// grounded in the Realtime transcription guide [O7]
// (https://developers.openai.com/api/docs/guides/realtime-transcription,
// fetched 2026-10-23, re-verified live 2026-10-27):
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

/**
 * Admission outcome consumed as data (gateway `admitSpeech` runs at
 * composition, L16/API — mesh never imports the gateway). The session
 * refuses to open without it and never exceeds its ceilings.
 */
export interface OpenAiTranscriptionAdmission {
  readonly operationId: string;
  readonly holdRef: string;
  readonly pricingRevision: string;
  readonly ceiling: { readonly connectedSeconds: number; readonly admittedAudioSeconds: number };
  readonly maxDurationMs: number;
}

export interface OpenAiTranscriptionUsageTotals {
  readonly connectedSeconds: number;
  readonly admittedAudioSeconds: number;
}

/**
 * Usage sink shaped for the gateway `recordSpeechUsage` / `settleSpeech`
 * calls the composition layer performs. The adapter only measures seconds;
 * pricing stays pinned at admission.
 */
export interface OpenAiTranscriptionUsageSink {
  /**
   * Maps to the L8 `recordSpeechUsage` call: operational evidence on the hold,
   * never a charge. The adapter sends `cumulative` totals under a stable
   * eventId so restarts and retries cannot double-count measured seconds.
   */
  record(update: {
    readonly eventId: string;
    readonly revision: number;
    readonly mode: 'cumulative' | 'incremental';
    readonly usage: Partial<OpenAiTranscriptionUsageTotals>;
  }): void | Promise<void>;
  /**
   * Maps to the L8 `settleSpeech` call. Usage stays absent unless provider-
   * reported (with a monotonic providerRevision): locally measured seconds
   * are estimates, and a usage covering every priced dimension without a
   * providerRevision is rejected by `settleSpeech` as invalid.
   */
  settle(request: {
    readonly operationId: string;
    readonly outcome: 'completed' | 'cancelled' | 'failed';
    readonly usage?: OpenAiTranscriptionUsageTotals;
    readonly providerRevision?: number;
  }): void | Promise<void>;
}

/** Injectable provider socket. Tests use recorded scripts; never a live call. */
export interface OpenAiTranscriptionSocket {
  send(message: string): void;
  messages(): AsyncIterable<string>;
  close(): Promise<void>;
}

export interface OpenAiTranscriptionConnect {
  (url: string, headers: { readonly authorization: string; readonly originator: string }): Promise<OpenAiTranscriptionSocket> | OpenAiTranscriptionSocket;
}

export interface OpenAiTranscriptionOpenOptions {
  readonly request: SpeechSessionRequest;
  readonly admission: OpenAiTranscriptionAdmission;
  /** Bearer material, used once for the socket handshake and never logged. */
  readonly bearerToken: string;
  readonly connect: OpenAiTranscriptionConnect;
  readonly usage: OpenAiTranscriptionUsageSink;
  readonly originator?: string;
  readonly nowMs?: () => number;
  /** Injectable expiry scheduler (tests advance it manually); defaults to setTimeout. */
  readonly schedule?: (delayMs: number, fn: () => void) => () => void;
  readonly signal?: AbortSignal;
}

/** Client turn pushed at `input.commit`; consumed by the provider `committed` frame. */
interface PendingTurn {
  readonly utteranceId: string;
  readonly startMs: number;
  readonly endMs: number;
}

const assertAdmission = (admission: OpenAiTranscriptionAdmission): void => {
  if (!admission || !isNonEmptyString(admission.operationId) || !isNonEmptyString(admission.holdRef)
    || !isNonEmptyString(admission.pricingRevision)
    || !(admission.ceiling?.connectedSeconds > 0) || !(admission.ceiling?.admittedAudioSeconds > 0)
    || !(admission.maxDurationMs > 0)) {
    throw new OpenAiTranscriptionError('admission', 'a valid admission (operation, hold, ceilings) is required');
  }
};

interface PendingItem {
  text: string;
  revision: number;
  /** Client utterance id (attributed live, confirmed by the `committed` bind). */
  utteranceId: string;
  audioStartMs: number;
  audioEndMs: number;
  finalized: boolean;
  speechSessionId: string;
  connectionEpoch: number;
  binding: SpeechBinding;
}

const monotonicNow = (nowMs: (() => number) | undefined): number => {
  const now = (nowMs ?? Date.now)();
  if (!Number.isFinite(now) || now < 0) throw new OpenAiTranscriptionError('invalid-config', 'clock must be finite');
  return now;
};

const errorEvent = (
  base: Pick<SpeechEventMetadata, 'speechSessionId' | 'connectionEpoch' | 'clock'>,
  eventId: string,
  sequence: number,
  reason: string,
  retryable: boolean,
): SpeechEvent => ({
  schemaVersion: 1,
  speechSessionId: base.speechSessionId,
  connectionEpoch: base.connectionEpoch,
  eventId,
  sequence,
  clock: base.clock,
  type: 'error',
  reason,
  retryable,
});

export class TranscriptionSession implements SpeechSession {
  readonly receipt: SpeechSessionReceipt;
  readonly events: AsyncIterable<SpeechEvent>;
  private readonly socket: OpenAiTranscriptionSocket;
  private readonly binding: SpeechBinding;
  private readonly admission: OpenAiTranscriptionAdmission;
  private readonly usage: OpenAiTranscriptionUsageSink;
  private readonly nowMs?: () => number;
  private readonly openedAtMs: number;
  private readonly items = new Map<string, PendingItem>();
  private readonly queue: SpeechEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private sequence = 0;
  private eventId = 0;
  private audioSeconds = 0;
  private settled = false;
  private outcome: 'completed' | 'cancelled' | 'failed' = 'completed';
  private readonly pump: Promise<void>;
  private readonly signal?: AbortSignal;
  private readonly effectiveMaxMs: number;
  private abortHandler?: () => void;
  private expiryCancel?: () => void;
  private inPump = false;
  private turnAudioStartMs?: number;
  private lastCapturedAtMs = 0;
  private openTurnUtteranceId?: string;
  private readonly turns: PendingTurn[] = [];
  private readonly bindings = new Map<string, PendingTurn>();
  /** Finalized items: late deltas/commits drop silently, a second final errors. */
  private readonly finalizedIds = new Set<string>();
  /** Cleared items: every late provider frame drops silently. */
  private readonly clearedIds = new Set<string>();
  private committedAudioSeconds = 0;
  private usageRevision = 0;

  constructor(
    receipt: SpeechSessionReceipt,
    socket: OpenAiTranscriptionSocket,
    binding: SpeechBinding,
    admission: OpenAiTranscriptionAdmission,
    usage: OpenAiTranscriptionUsageSink,
    nowMs: (() => number) | undefined,
    signal: AbortSignal | undefined,
    schedule: ((delayMs: number, fn: () => void) => () => void) | undefined,
    maxDurationMs: number,
  ) {
    this.receipt = receipt;
    this.socket = socket;
    this.binding = binding;
    this.admission = admission;
    this.usage = usage;
    this.nowMs = nowMs;
    this.signal = signal;
    this.openedAtMs = monotonicNow(nowMs);
    this.effectiveMaxMs = Math.min(admission.maxDurationMs, maxDurationMs);
    this.events = this.stream();
    this.pump = this.run(signal);
    const arm = schedule ?? ((delayMs: number, fn: () => void): (() => void) => {
      const timer = setTimeout(fn, delayMs);
      return () => clearTimeout(timer);
    });
    this.expiryCancel = arm(this.effectiveMaxMs, () => {
      this.pushError('ceiling', false);
      this.outcome = 'cancelled';
      void this.close();
    });
    if (signal) {
      if (signal.aborted) {
        this.outcome = 'cancelled';
        void this.close();
      } else {
        this.abortHandler = (): void => {
          this.outcome = 'cancelled';
          void this.close();
        };
        signal.addEventListener('abort', this.abortHandler, { once: true });
      }
    }
  }

  private nextId(): string {
    this.eventId += 1;
    return `evt-${this.eventId}`;
  }

  private emit(event: SpeechEvent): void {
    this.queue.push(event);
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  private clock(): { readonly id: string; readonly monotonicMs: number } {
    return { id: 'openai-transcription', monotonicMs: monotonicNow(this.nowMs) };
  }

  private async *stream(): AsyncIterable<SpeechEvent> {
    let index = 0;
    for (;;) {
      while (index >= this.queue.length) {
        if (this.settled) return;
        await new Promise<void>((resolve) => this.waiters.push(resolve));
      }
      const event = this.queue[index++] as SpeechEvent;
      // Bound the queue for long sessions: consumed events are dropped.
      if (index > 1024) {
        this.queue.splice(0, index);
        index = 0;
      }
      yield event;
    }
  }

  async write(frame: SpeechInputFrame): Promise<void> {
    if (this.settled) throw new OpenAiTranscriptionError('closed', 'session is closed');
    if (!isValidSpeechAudioFrame(frame) || frame.type !== 'audio.input') {
      throw new OpenAiTranscriptionError('invalid-format', 'audio.input frame failed validation');
    }
    if (frame.format.codec !== TRANSCRIPTION_FORMAT.codec
      || frame.format.sampleRateHz !== TRANSCRIPTION_FORMAT.sampleRateHz
      || frame.format.channels !== TRANSCRIPTION_FORMAT.channels) {
      throw new OpenAiTranscriptionError('invalid-format', 'only pcm16-le 24kHz mono is admitted');
    }
    if (monotonicNow(this.nowMs) - this.openedAtMs >= this.effectiveMaxMs) {
      throw new OpenAiTranscriptionError('ceiling', 'session duration bound reached');
    }
    const seconds = frame.sampleCount / frame.format.sampleRateHz;
    if (!(seconds > 0) || this.audioSeconds + seconds > this.admission.ceiling.admittedAudioSeconds) {
      throw new OpenAiTranscriptionError('ceiling', 'admitted audio ceiling reached');
    }
    this.audioSeconds += seconds;
    this.openTurnUtteranceId = frame.utteranceId;
    // Capture-domain turn window for the final's audioInterval (approximation
    // for sequential client turns; dispatch ordering stays with L2).
    if (Number.isFinite(frame.capturedAtMs) && frame.capturedAtMs >= 0) {
      this.turnAudioStartMs ??= frame.capturedAtMs;
      this.lastCapturedAtMs = Math.max(this.lastCapturedAtMs, frame.capturedAtMs);
    }
    // The payload is encoded and released here; the adapter retains only counters.
    const audio = base64Of(frame.payload);
    this.socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
  }

  async command(command: Parameters<SpeechSession['command']>[0]): Promise<void> {
    if (this.settled && command.type !== 'session.close') {
      throw new OpenAiTranscriptionError('closed', 'session is closed');
    }
    switch (command.type) {
      case 'input.commit': {
        if (monotonicNow(this.nowMs) - this.openedAtMs >= this.effectiveMaxMs) {
          throw new OpenAiTranscriptionError('ceiling', 'session duration bound reached');
        }
        this.socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        this.turns.push({
          utteranceId: command.utteranceId,
          startMs: this.turnAudioStartMs ?? 0,
          endMs: this.lastCapturedAtMs,
        });
        this.turnAudioStartMs = undefined;
        this.openTurnUtteranceId = undefined;
        // Cumulative operational totals (L8 sums incremental events per eventId,
        // so a per-turn total would double-count); the composition settles from these.
        this.committedAudioSeconds = this.audioSeconds;
        await this.usage.record({
          eventId: `${this.admission.operationId}:audio`,
          revision: this.usageRevision++,
          mode: 'cumulative',
          usage: {
            admittedAudioSeconds: this.committedAudioSeconds,
            connectedSeconds: Math.max(0, (monotonicNow(this.nowMs) - this.openedAtMs) / 1000),
          },
        });
        return;
      }
      case 'input.clear':
        // Clear the uncommitted provider buffer, then drop every local trace
        // of the client utterance so late provider frames cannot resurrect it.
        this.socket.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
        for (let index = this.turns.length - 1; index >= 0; index--) {
          if (this.turns[index]?.utteranceId === command.utteranceId) this.turns.splice(index, 1);
        }
        for (const [itemId, turn] of this.bindings) {
          if (turn.utteranceId === command.utteranceId) {
            this.clearedIds.add(itemId);
            this.bindings.delete(itemId);
          }
        }
        for (const [itemId, item] of this.items) {
          if (item.utteranceId === command.utteranceId) {
            this.clearedIds.add(itemId);
            this.items.delete(itemId);
          }
        }
        if (this.openTurnUtteranceId === command.utteranceId) this.openTurnUtteranceId = undefined;
        return;
      case 'session.mute':
        // Mute is enforced by capture (no audio written); the cloud adapter holds no gate.
        return;
      case 'session.close':
        await this.close();
        return;
      default:
        throw new OpenAiTranscriptionError('unsupported-command', `not applicable to STT-only transcription: ${command.type}`);
    }
  }

  async close(): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    this.expiryCancel?.();
    this.expiryCancel = undefined;
    if (this.signal && this.abortHandler) this.signal.removeEventListener('abort', this.abortHandler);
    try {
      await this.socket.close();
    } finally {
      // No usage attached: locally measured seconds are operational estimates,
      // not provider-attested finals. The composition settles from the recorded
      // cumulative totals (or provider-reported usage with a revision), so an
      // L8 `settleSpeech` missing-dimension estimate stays valid.
      await this.usage.settle({
        operationId: this.admission.operationId,
        outcome: this.outcome,
      });
      while (this.waiters.length > 0) this.waiters.shift()?.();
      if (!this.inPump) await this.pump.catch(() => undefined);
    }
  }

  private pushError(reason: string, retryable: boolean): void {
    this.sequence += 1;
    this.emit(errorEvent(
      { speechSessionId: this.receipt.speechSessionId, connectionEpoch: this.receipt.connectionEpoch, clock: this.clock() },
      this.nextId(), this.sequence, reason, retryable,
    ));
  }

  /**
   * Resolve the client turn for a provider item. Committed binds are
   * authoritative; before the `committed` frame arrives the oldest
   * unconfirmed turn is used (peeked, never consumed), falling back to the
   * turn currently being recorded. Sequential client turns make all three agree.
   */
  private attribute(itemId: string): PendingTurn | undefined {
    const bound = this.bindings.get(itemId);
    if (bound) return bound;
    if (this.turns.length > 0) return this.turns[0];
    if (this.openTurnUtteranceId !== undefined) {
      return {
        utteranceId: this.openTurnUtteranceId,
        startMs: this.turnAudioStartMs ?? 0,
        endMs: this.lastCapturedAtMs,
      };
    }
    return undefined;
  }

  private newItem(itemId: string, turn: PendingTurn): PendingItem {
    const item: PendingItem = {
      text: '',
      revision: 0,
      utteranceId: turn.utteranceId,
      audioStartMs: turn.startMs,
      audioEndMs: turn.endMs,
      finalized: false,
      speechSessionId: this.receipt.speechSessionId,
      connectionEpoch: this.receipt.connectionEpoch,
      binding: this.binding,
    };
    this.items.set(itemId, item);
    return item;
  }

  private onCommitted(itemId: string): void {
    if (this.finalizedIds.has(itemId) || this.clearedIds.has(itemId)) return;
    const turn = this.turns.shift();
    if (!turn) {
      this.pushError('invalid-format', true);
      return;
    }
    this.bindings.set(itemId, turn);
    // The bind is authoritative: align a live hypothesis created by early deltas.
    const item = this.items.get(itemId);
    if (item && !item.finalized) {
      item.utteranceId = turn.utteranceId;
      item.audioStartMs = turn.startMs;
      item.audioEndMs = Math.max(turn.endMs, this.lastCapturedAtMs);
    }
  }

  private onDelta(itemId: string, contentIndex: number, delta: string): void {
    if (contentIndex !== 0) {
      this.pushError('invalid-format', true);
      return;
    }
    if (this.finalizedIds.has(itemId) || this.clearedIds.has(itemId)) return;
    let item = this.items.get(itemId);
    if (!item) {
      const turn = this.attribute(itemId);
      if (!turn) {
        this.pushError('invalid-format', true);
        return;
      }
      item = this.newItem(itemId, turn);
    }
    if (item.finalized) return;
    const start = item.text.length;
    item.text += delta;
    item.revision += 1;
    this.sequence += 1;
    const partial: SpeechTranscriptPartial = {
      schemaVersion: 1,
      speechSessionId: item.speechSessionId,
      connectionEpoch: item.connectionEpoch,
      eventId: this.nextId(),
      sequence: this.sequence,
      clock: this.clock(),
      type: 'transcript.partial',
      binding: this.binding,
      utteranceId: item.utteranceId,
      revision: item.revision,
      replaces: { start, end: start },
      text: delta,
    };
    this.emit(partial);
  }

  private onCompleted(itemId: string, transcript: string, languages: unknown): void {
    if (this.clearedIds.has(itemId)) return;
    if (this.finalizedIds.has(itemId)) {
      this.pushError('invalid-format', true);
      return;
    }
    let item = this.items.get(itemId);
    if (!item) {
      // A completion without prior deltas (empty turn, unsent deltas for the
      // model/delay) still finalizes the bound turn; otherwise it is orphaned.
      const bound = this.bindings.get(itemId);
      const turn = bound ?? this.attribute(itemId);
      if (!turn) {
        this.pushError('invalid-format', true);
        return;
      }
      item = this.newItem(itemId, turn);
    }
    if (item.finalized) {
      this.pushError('invalid-format', true);
      return;
    }
    item.finalized = true;
    this.finalizedIds.add(itemId);
    item.revision += 1;
    item.audioEndMs = Math.max(item.audioEndMs, this.lastCapturedAtMs);
    this.sequence += 1;
    let language = this.binding.language;
    if (!language && Array.isArray(languages)) {
      const first = languages[0] as { code?: unknown } | undefined;
      if (first && typeof first.code === 'string' && first.code) language = first.code;
    }
    const final: SpeechTranscriptFinal = {
      schemaVersion: 1,
      speechSessionId: item.speechSessionId,
      connectionEpoch: item.connectionEpoch,
      eventId: this.nextId(),
      sequence: this.sequence,
      clock: this.clock(),
      type: 'transcript.final',
      binding: this.binding,
      utteranceId: item.utteranceId,
      revision: item.revision,
      text: transcript,
      language: language ?? 'und',
      audioInterval: { startMs: item.audioStartMs, endMs: item.audioEndMs },
    };
    // Partials are ephemeral: the hypothesis buffer is released with the final.
    this.items.delete(itemId);
    this.emit(final);
  }

  private onFrame(raw: string): void {
    if (this.settled) return;
    let frame: unknown;
    try {
      frame = JSON.parse(raw) as unknown;
    } catch {
      this.pushError('invalid-format', true);
      return;
    }
    if (!frame || typeof frame !== 'object') {
      this.pushError('invalid-format', true);
      return;
    }
    const type = (frame as Record<string, unknown>).type;
    if (type === 'conversation.item.input_audio_transcription.delta') {
      const record = frame as Record<string, unknown>;
      if (!isNonEmptyString(record.item_id) || typeof record.delta !== 'string'
        || typeof record.content_index !== 'number') {
        this.pushError('invalid-format', true);
        return;
      }
      this.onDelta(record.item_id, record.content_index, record.delta);
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const record = frame as Record<string, unknown>;
      if (!isNonEmptyString(record.item_id) || typeof record.transcript !== 'string') {
        this.pushError('invalid-format', true);
        return;
      }
      this.onCompleted(record.item_id, record.transcript, record.languages);
      return;
    }
    if (type === 'input_audio_buffer.committed') {
      const record = frame as Record<string, unknown>;
      if (!isNonEmptyString(record.item_id)) {
        this.pushError('invalid-format', true);
        return;
      }
      this.onCommitted(record.item_id);
      return;
    }
    if (type === 'error') {
      this.pushError('provider-error', false);
      return;
    }
    // Unknown provider event types are tolerated (forward compatibility); the stream continues.
  }

  private async run(signal: AbortSignal | undefined): Promise<void> {
    this.inPump = true;
    try {
      for await (const raw of this.socket.messages()) {
        if (this.settled) break;
        if (signal?.aborted) {
          this.outcome = 'cancelled';
          break;
        }
        this.onFrame(raw);
      }
    } catch {
      if (!this.settled) {
        this.outcome = 'failed';
        this.pushError('transport', false);
      }
    } finally {
      this.inPump = false;
      if (!this.settled) await this.close();
    }
  }
}

/**
 * Redact the bearer material from any message before it reaches an error.
 * A provider that echoes the Authorization header must never leak it through
 * session events or thrown errors.
 */
const redactBearer = (message: string, token: string): string => {
  if (!token) return message;
  return message.split(`Bearer ${token}`).join('Bearer [REDACTED]').split(token).join('[REDACTED]');
};

/**
 * Open an admitted transcription session. The bearer token travels only into
 * the socket handshake; failures never echo it. The `session.update` is sent
 * before any audio; an aborted signal refuses without connecting.
 */
export const openTranscriptionSession = async (
  config: OpenAiTranscriptionProfileConfig,
  options: OpenAiTranscriptionOpenOptions,
): Promise<TranscriptionSession> => {
  const capabilities = openAiTranscriptionCapabilities(config);
  const binding: SpeechBinding = {
    ...openAiTranscriptionIdentity(config),
    ...(config.language ? { language: config.language } : {}),
    ...(config.accountRef ? { accountRef: config.accountRef } : {}),
    ...(config.region ? { region: config.region } : {}),
  };
  assertAdmission(options.admission);
  if (!isNonEmptyString(options.bearerToken)) {
    throw new OpenAiTranscriptionError('invalid-config', 'bearer token is required');
  }
  const { request } = options;
  // TTS bindings are refused here (fail-closed): a later duplex composition
  // may split them onto a synthesis adapter, but this module never synthesizes.
  if (request.pipeline !== 'chained' || request.bindings.stt === undefined
    || request.bindings.stt.providerId !== binding.providerId
    || request.bindings.stt.modelId !== binding.modelId
    || request.bindings.tts !== undefined) {
    throw new OpenAiTranscriptionError('invalid-config', 'STT-only chained binding for this profile is required');
  }
  for (const format of [...(request.inputFormats ?? []), ...(request.outputFormats ?? [])]) {
    if (format.codec !== TRANSCRIPTION_FORMAT.codec || format.sampleRateHz !== TRANSCRIPTION_FORMAT.sampleRateHz
      || format.channels !== TRANSCRIPTION_FORMAT.channels) {
      throw new OpenAiTranscriptionError('invalid-config', 'only pcm16-le 24kHz mono is supported');
    }
  }
  if (options.signal?.aborted) {
    throw new OpenAiTranscriptionError('aborted', 'open aborted before connect');
  }
  const receipt: SpeechSessionReceipt = {
    protocolVersion: 1,
    speechSessionId: `speech-${options.admission.operationId}`,
    connectionEpoch: request.target.controllerEpoch,
    configuration: request.configuration,
    target: request.target,
    pipeline: 'chained',
    micMode: request.micMode,
    stages: { stt: capabilities },
    inputFormat: TRANSCRIPTION_FORMAT,
  };
  let socket: OpenAiTranscriptionSocket;
  try {
    socket = await options.connect(OPENAI_TRANSCRIPTION_WS_URL, {
      authorization: `Bearer ${options.bearerToken}`,
      originator: options.originator ?? 'sentropic-llm-mesh',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    throw new OpenAiTranscriptionError('transport', `provider connect failed: ${redactBearer(detail, options.bearerToken)}`);
  }
  const session = new TranscriptionSession(
    receipt, socket, binding, options.admission, options.usage, options.nowMs, options.signal,
    options.schedule, request.maxDurationMs,
  );
  try {
    socket.send(JSON.stringify(buildTranscriptionSessionUpdate(config)));
  } catch (error) {
    await session.close();
    const detail = error instanceof Error ? error.message : 'unknown';
    throw new OpenAiTranscriptionError('transport', `session update failed: ${redactBearer(detail, options.bearerToken)}`);
  }
  return session;
};
