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
  record(update: {
    readonly eventId: string;
    readonly revision: number;
    readonly mode: 'cumulative' | 'incremental';
    readonly usage: Partial<OpenAiTranscriptionUsageTotals>;
  }): void | Promise<void>;
  settle(request: {
    readonly operationId: string;
    readonly outcome: 'completed' | 'cancelled' | 'failed';
    readonly usage: OpenAiTranscriptionUsageTotals;
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
  readonly signal?: AbortSignal;
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
  private revision = 0;
  private audioSeconds = 0;
  private settled = false;
  private outcome: 'completed' | 'cancelled' | 'failed' = 'completed';
  private readonly pump: Promise<void>;
  private readonly signal?: AbortSignal;
  private abortHandler?: () => void;
  private turnAudioStartMs?: number;
  private lastCapturedAtMs = 0;

  constructor(
    receipt: SpeechSessionReceipt,
    socket: OpenAiTranscriptionSocket,
    binding: SpeechBinding,
    admission: OpenAiTranscriptionAdmission,
    usage: OpenAiTranscriptionUsageSink,
    nowMs: (() => number) | undefined,
    signal: AbortSignal | undefined,
  ) {
    this.receipt = receipt;
    this.socket = socket;
    this.binding = binding;
    this.admission = admission;
    this.usage = usage;
    this.nowMs = nowMs;
    this.signal = signal;
    this.openedAtMs = monotonicNow(nowMs);
    this.pump = this.run(signal);
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

  async *events(): AsyncIterable<SpeechEvent> {
    let index = 0;
    for (;;) {
      while (index >= this.queue.length) {
        if (this.settled) return;
        await new Promise<void>((resolve) => this.waiters.push(resolve));
      }
      yield this.queue[index++] as SpeechEvent;
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
    const seconds = frame.sampleCount / frame.format.sampleRateHz;
    if (!(seconds > 0) || this.audioSeconds + seconds > this.admission.ceiling.admittedAudioSeconds) {
      throw new OpenAiTranscriptionError('ceiling', 'admitted audio ceiling reached');
    }
    this.audioSeconds += seconds;
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
      case 'input.commit':
        this.socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        this.turnAudioStartMs = undefined;
        await this.usage.record({
          eventId: command.utteranceId,
          revision: this.revision++,
          mode: 'incremental',
          usage: { admittedAudioSeconds: this.audioSeconds },
        });
        return;
      case 'input.clear':
        for (const [id, item] of this.items) {
          if (!item.finalized && id === command.utteranceId) this.items.delete(id);
        }
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
    if (this.signal && this.abortHandler) this.signal.removeEventListener('abort', this.abortHandler);
    try {
      await this.socket.close();
    } finally {
      const connectedSeconds = Math.max(0, (monotonicNow(this.nowMs) - this.openedAtMs) / 1000);
      const totals = { connectedSeconds, admittedAudioSeconds: this.audioSeconds };
      await this.usage.settle({
        operationId: this.admission.operationId,
        outcome: this.outcome,
        usage: totals,
      });
      const waiter = this.waiters.shift();
      if (waiter) waiter();
      await this.pump.catch(() => undefined);
    }
  }

  private pushError(reason: string, retryable: boolean): void {
    this.sequence += 1;
    this.emit(errorEvent(
      { speechSessionId: this.receipt.speechSessionId, connectionEpoch: this.receipt.connectionEpoch, clock: this.clock() },
      this.nextId(), this.sequence, reason, retryable,
    ));
  }

  private onDelta(itemId: string, contentIndex: number, delta: string): void {
    if (contentIndex !== 0) {
      this.pushError('invalid-format', true);
      return;
    }
    let item = this.items.get(itemId);
    if (!item) {
      item = {
        text: '', revision: 0, audioStartMs: this.turnAudioStartMs ?? 0, audioEndMs: this.lastCapturedAtMs,
        finalized: false,
        speechSessionId: this.receipt.speechSessionId,
        connectionEpoch: this.receipt.connectionEpoch,
        binding: this.binding,
      };
      this.items.set(itemId, item);
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
      utteranceId: itemId,
      revision: item.revision,
      replaces: { start, end: start },
      text: delta,
    };
    this.emit(partial);
  }

  private onCompleted(itemId: string, transcript: string, languages: unknown): void {
    const item = this.items.get(itemId);
    if (!item) {
      this.pushError('invalid-format', true);
      return;
    }
    if (item.finalized) {
      this.pushError('invalid-format', true);
      return;
    }
    item.finalized = true;
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
      utteranceId: itemId,
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
