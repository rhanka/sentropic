// Mistral streaming STT (L13): `mistral-voxtral-realtime-3` behind the mesh
// speech contract, plus the Mistral TTS binding/registry entry. Wire facts are
// grounded in the Mistral Studio audio docs [O8]
// (https://docs.mistral.ai/studio/audio/speech-to-text/transcribe-in-realtime
// and https://docs.mistral.ai/studio/audio/text-to-speech/generate-speech,
// fetched 2026-10-28):
// realtime WebSocket
// `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-3`
// (model in the query, Bearer handshake), `session.created` (wait for it
// before anything else), `session.update` with a `session` object
// (audio_format pcm_s16le + sample rate, target_streaming_delay_ms,
// language), `session.updated` echo, PCM audio via `input_audio.append`,
// append-only `transcription.text.delta` finals (no correction), then
// `input_audio.end` and `transcription.done` with the transcript of record.
// `turn_detection` stays off: client commits drive turns. The 2602 models are
// deprecated and refused here; the 3.0 preview is pinned exactly.
// TTS is selection/binding only: `POST /v1/audio/speech` with model
// `voxtral-mini-tts-3-0`, voice_id and response_format. The mesh holds no
// synthesis transport; the HTTPS call happens at composition. Recorded
// fixtures only: no live provider call in tests or CI.
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

export const MISTRAL_TRANSCRIPTION_PROVIDER_ID = 'mistral';
export const MISTRAL_TRANSCRIPTION_ADAPTER_ID = 'mistral-transcription';
export const MISTRAL_TRANSCRIPTION_ADAPTER_REVISION = '1';
export const MISTRAL_TRANSCRIPTION_PLACEMENT = 'cloud-relay' as const;
export const MISTRAL_TRANSCRIPTION_MODEL_ID = 'voxtral-mini-transcribe-realtime-3';
export const MISTRAL_TRANSCRIPTION_WS_URL =
  'wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-3';

/** The only STT model this adapter serves. The 2602 generation is refused. */
export const mistralTranscriptionModels = ['voxtral-mini-transcribe-realtime-3'] as const;
export type MistralTranscriptionModelId = (typeof mistralTranscriptionModels)[number];

/**
 * Trade speed for accuracy per session. Bounds follow the docs: 80 to 1200,
 * or exactly 2400. No implicit default: the profile pins one.
 */
export const MISTRAL_TRANSCRIPTION_DELAY_MIN_MS = 80;
export const MISTRAL_TRANSCRIPTION_DELAY_MAX_MS = 1200;
export const MISTRAL_TRANSCRIPTION_DELAY_SLOW_MS = 2400;

/** Independent per-profile configuration. No shared mutable state between profiles. */
export interface MistralTranscriptionProfileConfig {
  readonly modelId: MistralTranscriptionModelId;
  /** Served model snapshot pinned at admission; never an unreviewed `latest` alias. */
  readonly modelRevision: string;
  /** Wait in ms trading speed for accuracy (80-1200, or exactly 2400). */
  readonly targetStreamingDelayMs: number;
  /** Two-letter ISO 639-1 code. Unset lets the model detect the language. */
  readonly language?: string;
  /** Client-owned turn detection only. Any other value refuses at open. */
  readonly turnDetection?: 'client';
  readonly accountRef?: string;
}

const TRANSCRIPTION_FORMAT: SpeechAudioFormat = { codec: 'pcm16-le', sampleRateHz: 24000, channels: 1 };

export const mistralTranscriptionIdentity = (
  config: MistralTranscriptionProfileConfig,
): SpeechEngineIdentity => ({
  providerId: MISTRAL_TRANSCRIPTION_PROVIDER_ID,
  modelId: config.modelId,
  modelRevision: config.modelRevision,
  adapterId: MISTRAL_TRANSCRIPTION_ADAPTER_ID,
  adapterRevision: MISTRAL_TRANSCRIPTION_ADAPTER_REVISION,
  placement: MISTRAL_TRANSCRIPTION_PLACEMENT,
});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isDelayMs = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value)
  && ((value >= MISTRAL_TRANSCRIPTION_DELAY_MIN_MS
    && value <= MISTRAL_TRANSCRIPTION_DELAY_MAX_MS) || value === MISTRAL_TRANSCRIPTION_DELAY_SLOW_MS);

const isLanguageCode = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z]{2}$/u.test(value);

/** Per-profile STT capabilities. TTS is unsupported: synthesis is selected separately. */
export const mistralTranscriptionCapabilities = (
  config: MistralTranscriptionProfileConfig,
): SpeechCapabilities => {
  if (!mistralTranscriptionModels.includes(config.modelId)) {
    throw new MistralTranscriptionError('unknown-model',
      `unknown Mistral transcription model: ${String(config.modelId)} (2602 models are not served here)`);
  }
  if (!isNonEmptyString(config.modelRevision)) {
    throw new MistralTranscriptionError('invalid-config', 'modelRevision must be a pinned non-empty revision');
  }
  if (!isDelayMs(config.targetStreamingDelayMs)) {
    throw new MistralTranscriptionError('invalid-config',
      `targetStreamingDelayMs must be 80-1200 or exactly 2400, got ${String(config.targetStreamingDelayMs)}`);
  }
  if (config.language !== undefined && !isLanguageCode(config.language)) {
    throw new MistralTranscriptionError('invalid-config',
      `language must be a two-letter ISO 639-1 code, got ${String(config.language)}`);
  }
  if (config.turnDetection !== undefined && config.turnDetection !== 'client') {
    throw new MistralTranscriptionError('invalid-config', 'only client turn detection is supported for this profile');
  }
  return {
    binding: mistralTranscriptionIdentity(config),
    ...(config.language ? { languages: [config.language] } : {}),
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

/**
 * Exact `session.update` body. `turn_detection` is omitted (server turn
 * detection unsupported); the provider fixes settings at the first audio.
 */
export const buildMistralSessionUpdate = (
  config: MistralTranscriptionProfileConfig,
): Record<string, unknown> => {
  // Reuse the capability gate so the wire can never carry an unvalidated profile.
  mistralTranscriptionCapabilities(config);
  return {
    type: 'session.update',
    session: {
      audio_format: { encoding: 'pcm_s16le', sample_rate: TRANSCRIPTION_FORMAT.sampleRateHz },
      target_streaming_delay_ms: config.targetStreamingDelayMs,
      ...(config.language ? { language: config.language } : {}),
    },
  };
};

export class MistralTranscriptionError extends Error {
  readonly code: 'unknown-model' | 'invalid-config' | 'admission' | 'ceiling' | 'closed'
    | 'aborted' | 'transport' | 'invalid-format' | 'unsupported-command';
  constructor(code: MistralTranscriptionError['code'], message: string) {
    super(message);
    this.name = 'MistralTranscriptionError';
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

// ---------------------------------------------------------------------------
// TTS binding/registry (selection data only; no synthesis transport in mesh)
// ---------------------------------------------------------------------------

export const MISTRAL_TTS_PROVIDER_ID = 'mistral';
export const MISTRAL_TTS_ADAPTER_ID = 'mistral-tts';
export const MISTRAL_TTS_ADAPTER_REVISION = '1';
export const MISTRAL_TTS_PLACEMENT = 'cloud-relay' as const;
export const MISTRAL_TTS_MODEL_ID = 'voxtral-mini-tts-3-0';
export const MISTRAL_TTS_ENDPOINT = 'https://api.mistral.ai/v1/audio/speech';

/**
 * Pinned Voxtral 3 preset voices (docs voice library). The mesh pins the
 * selection; voice creation/management stays a console/API operation.
 */
export const mistralTtsVoices = [
  'voice_478', 'voice_447', 'voice_485', 'voice_3150',
  'voice_1787', 'voice_1786', 'voice_1788', 'voice_590', 'voice_591', 'voice_3149', 'voice_3147',
  'voice_592', 'voice_3137', 'voice_589', 'voice_3141',
  'voice_483', 'voice_481', 'voice_482', 'voice_480', 'voice_479', 'voice_3143',
  'voice_3139', 'voice_3153', 'voice_3146', 'voice_3133', 'voice_3136', 'voice_3135',
  'voice_3145', 'voice_3134', 'voice_3154', 'voice_3155', 'voice_3132', 'voice_3138',
  'voice_3140', 'voice_3144', 'voice_3142',
] as const;
export type MistralTtsVoiceId = (typeof mistralTtsVoices)[number];

/** Languages covered by the pinned preset voices (voice implies language). */
export const mistralTtsLanguages = [
  'en', 'fr', 'es', 'de', 'it', 'pt', 'ar', 'ca', 'hi', 'hu',
  'ja', 'ko', 'nl', 'no', 'pl', 'ro', 'ru', 'tr', 'uk', 'vi', 'zh',
] as const;

export const mistralTtsResponseFormats = ['mp3', 'wav'] as const;
export type MistralTtsResponseFormat = (typeof mistralTtsResponseFormats)[number];

export const mistralTtsIdentity = (modelRevision: string): SpeechEngineIdentity => {
  if (!isNonEmptyString(modelRevision)) {
    throw new MistralTranscriptionError('invalid-config', 'TTS modelRevision must be a pinned non-empty revision');
  }
  return {
    providerId: MISTRAL_TTS_PROVIDER_ID,
    modelId: MISTRAL_TTS_MODEL_ID,
    modelRevision,
    adapterId: MISTRAL_TTS_ADAPTER_ID,
    adapterRevision: MISTRAL_TTS_ADAPTER_REVISION,
    placement: MISTRAL_TTS_PLACEMENT,
  };
};

/**
 * TTS selection capabilities. Usage is metered in characters (price
 * separation from STT audio-seconds). Regions stay unset: the speech API
 * documents no region selector, so an explicit region refuses fail-closed.
 * No implicit voice: the request builder requires an explicit voice_id.
 */
export const mistralTtsCapabilities = (
  modelRevision: string,
  language?: string,
): SpeechCapabilities => {
  if (language !== undefined && !isLanguageCode(language)) {
    throw new MistralTranscriptionError('invalid-config',
      `language must be a two-letter ISO 639-1 code, got ${String(language)}`);
  }
  return {
    binding: mistralTtsIdentity(modelRevision),
    ...(language ? { languages: [language] } : { languages: [...mistralTtsLanguages] }),
    voices: [...mistralTtsVoices],
    features: {
      streamingStt: 'unsupported',
      partialTranscript: 'unsupported',
      nativeDuplex: 'unsupported',
      tts: 'supported',
      serverVad: 'unsupported',
      clientVad: 'unsupported',
      manualCommit: 'unsupported',
      playoutTruncate: 'unsupported',
      toolCancellation: 'unsupported',
      resume: 'unknown',
    },
    inputFormats: [],
    outputFormats: [{ codec: 'pcm16-le', sampleRateHz: 24000, channels: 1 }],
    usageUnits: ['characters'],
  };
};

export interface MistralTtsRequestShape {
  readonly voiceId: string;
  readonly input: string;
  readonly responseFormat: MistralTtsResponseFormat;
}

/**
 * Exact `POST /v1/audio/speech` body. No implicit voice and no unbounded
 * input: the composition performs the HTTPS call, the mesh only builds the
 * validated shape. Recorded fixtures only.
 */
export const buildMistralTtsRequest = (request: MistralTtsRequestShape): Record<string, unknown> => {
  if (!mistralTtsVoices.includes(request.voiceId as MistralTtsVoiceId)) {
    throw new MistralTranscriptionError('invalid-config', `unknown Mistral TTS voice: ${request.voiceId}`);
  }
  if (!isNonEmptyString(request.input)) {
    throw new MistralTranscriptionError('invalid-config', 'TTS input must be non-empty text');
  }
  if (!mistralTtsResponseFormats.includes(request.responseFormat)) {
    throw new MistralTranscriptionError('invalid-config',
      `responseFormat must be one of ${mistralTtsResponseFormats.join(', ')}`);
  }
  return {
    model: MISTRAL_TTS_MODEL_ID,
    input: request.input,
    voice_id: request.voiceId,
    response_format: request.responseFormat,
  };
};

// ---------------------------------------------------------------------------
// Session ports (mirror the L8/L9 seam; mesh never imports the gateway)
// ---------------------------------------------------------------------------

/**
 * Admission outcome consumed as data (gateway `admitSpeech` runs at
 * composition, L16/API — mesh never imports the gateway). The session
 * refuses to open without it and never exceeds its ceilings.
 */
export interface MistralTranscriptionAdmission {
  readonly operationId: string;
  readonly holdRef: string;
  readonly pricingRevision: string;
  readonly ceiling: { readonly connectedSeconds: number; readonly admittedAudioSeconds: number };
  readonly maxDurationMs: number;
}

export interface MistralTranscriptionUsageTotals {
  readonly connectedSeconds: number;
  readonly admittedAudioSeconds: number;
}

/**
 * Usage sink shaped for the gateway `recordSpeechUsage` / `settleSpeech`
 * calls the composition layer performs. The adapter only measures seconds;
 * pricing stays pinned at admission.
 */
export interface MistralTranscriptionUsageSink {
  /**
   * Maps to the L8 `recordSpeechUsage` call: operational evidence on the hold,
   * never a charge. The adapter sends `cumulative` totals under a stable
   * eventId so restarts and retries cannot double-count measured seconds.
   */
  record(update: {
    readonly eventId: string;
    readonly revision: number;
    readonly mode: 'cumulative' | 'incremental';
    readonly usage: Partial<MistralTranscriptionUsageTotals>;
  }): void | Promise<void>;
  /**
   * Maps to the L8 `settleSpeech` call. Usage stays absent unless provider-
   * reported (with a monotonic providerRevision): locally measured seconds
   * are estimates, and a usage covering every priced dimension without a
   * providerRevision is rejected by `settleSpeech` as invalid. The
   * `transcription.done` usage block is opaque (no revision semantics
   * documented) and is never settled.
   */
  settle(request: {
    readonly operationId: string;
    readonly outcome: 'completed' | 'cancelled' | 'failed';
    readonly usage?: MistralTranscriptionUsageTotals;
    readonly providerRevision?: number;
  }): void | Promise<void>;
}

/** Injectable provider socket. Tests use recorded scripts; never a live call. */
export interface MistralTranscriptionSocket {
  send(message: string): void;
  messages(): AsyncIterable<string>;
  close(): Promise<void>;
}

export interface MistralTranscriptionConnect {
  (url: string, headers: { readonly authorization: string; readonly originator: string }): Promise<MistralTranscriptionSocket> | MistralTranscriptionSocket;
}

export interface MistralTranscriptionOpenOptions {
  readonly request: SpeechSessionRequest;
  readonly admission: MistralTranscriptionAdmission;
  /** Bearer token, used once for the socket handshake and never logged. */
  readonly bearerToken: string;
  readonly connect: MistralTranscriptionConnect;
  readonly usage: MistralTranscriptionUsageSink;
  readonly originator?: string;
  readonly nowMs?: () => number;
  /** Injectable expiry scheduler (tests advance it manually); defaults to setTimeout. */
  readonly schedule?: (delayMs: number, fn: () => void) => () => void;
  readonly signal?: AbortSignal;
}

const assertAdmission = (admission: MistralTranscriptionAdmission): void => {
  if (!admission || !isNonEmptyString(admission.operationId) || !isNonEmptyString(admission.holdRef)
    || !isNonEmptyString(admission.pricingRevision)
    || !(admission.ceiling?.connectedSeconds > 0) || !(admission.ceiling?.admittedAudioSeconds > 0)
    || !(admission.maxDurationMs > 0)) {
    throw new MistralTranscriptionError('admission', 'a valid admission (operation, hold, ceilings) is required');
  }
};

interface TurnStream {
  readonly socket: MistralTranscriptionSocket;
  readonly utteranceId: string;
  readonly audioStartMs: number;
  audioEndMs: number;
  text: string;
  revision: number;
  /** The client ended this turn; the provider `done` is still in flight. */
  donePending: boolean;
  /** Abandoned by clear/close or superseded: late frames drop silently. */
  abandoned: boolean;
  doneReceived: boolean;
  resolveDone: (text: string | undefined) => void;
  donePromise: Promise<string | undefined>;
}

const monotonicNow = (nowMs: (() => number) | undefined): number => {
  const now = (nowMs ?? Date.now)();
  if (!Number.isFinite(now) || now < 0) throw new MistralTranscriptionError('invalid-config', 'clock must be finite');
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

export class MistralTranscriptionSession implements SpeechSession {
  readonly receipt: SpeechSessionReceipt;
  readonly events: AsyncIterable<SpeechEvent>;
  private readonly binding: SpeechBinding;
  private readonly admission: MistralTranscriptionAdmission;
  private readonly usage: MistralTranscriptionUsageSink;
  private readonly config: MistralTranscriptionProfileConfig;
  /** Bound provider dial (URL + handshake); the session holds no key material. */
  private readonly openProviderStream: () => Promise<MistralTranscriptionSocket>;
  /** Redaction bound at open; handshake failures never echo the token. */
  private readonly redact: (message: string) => string;
  private readonly nowMs?: () => number;
  private readonly openedAtMs: number;
  private readonly queue: SpeechEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private sequence = 0;
  private eventId = 0;
  private audioSeconds = 0;
  private settled = false;
  private outcome: 'completed' | 'cancelled' | 'failed' = 'completed';
  private readonly signal?: AbortSignal;
  private readonly effectiveMaxMs: number;
  private abortHandler?: () => void;
  private expiryCancel?: () => void;
  /** Active per-turn pumps; close() joins them unless called from a pump. */
  private pumps = 0;
  private readonly pumpPromises = new Set<Promise<void>>();
  private current?: TurnStream;
  /** UtteranceIds with an emitted final: commit is a no-op, writes refuse. */
  private readonly finalizedIds = new Set<string>();
  private usageRevision = 0;

  constructor(
    receipt: SpeechSessionReceipt,
    binding: SpeechBinding,
    admission: MistralTranscriptionAdmission,
    usage: MistralTranscriptionUsageSink,
    config: MistralTranscriptionProfileConfig,
    openProviderStream: () => Promise<MistralTranscriptionSocket>,
    redact: (message: string) => string,
    nowMs: (() => number) | undefined,
    signal: AbortSignal | undefined,
    schedule: ((delayMs: number, fn: () => void) => () => void) | undefined,
    maxDurationMs: number,
  ) {
    this.receipt = receipt;
    this.binding = binding;
    this.admission = admission;
    this.usage = usage;
    this.config = config;
    this.openProviderStream = openProviderStream;
    this.redact = redact;
    this.nowMs = nowMs;
    this.signal = signal;
    this.openedAtMs = monotonicNow(nowMs);
    this.effectiveMaxMs = Math.min(admission.maxDurationMs, maxDurationMs);
    this.events = this.stream();
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
    return { id: 'mistral-transcription', monotonicMs: monotonicNow(this.nowMs) };
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

  private pushError(reason: string, retryable: boolean): void {
    this.sequence += 1;
    this.emit(errorEvent(
      { speechSessionId: this.receipt.speechSessionId, connectionEpoch: this.receipt.connectionEpoch, clock: this.clock() },
      this.nextId(), this.sequence, reason, retryable,
    ));
  }

  private async recordUsage(): Promise<void> {
    // Cumulative operational totals (L8 sums incremental events per eventId,
    // so a per-turn total would double-count); the composition settles from these.
    await this.usage.record({
      eventId: `${this.admission.operationId}:audio`,
      revision: this.usageRevision++,
      mode: 'cumulative',
      usage: {
        admittedAudioSeconds: this.audioSeconds,
        connectedSeconds: Math.max(0, (monotonicNow(this.nowMs) - this.openedAtMs) / 1000),
      },
    });
  }

  private emitEmptyFinal(utteranceId: string): void {
    // A commit with no audio since the last turn boundary: the provider
    // would confirm an empty transcript, so the final carries no window.
    this.finalizedIds.add(utteranceId);
    this.sequence += 1;
    const final: SpeechTranscriptFinal = {
      schemaVersion: 1,
      speechSessionId: this.receipt.speechSessionId,
      connectionEpoch: this.receipt.connectionEpoch,
      eventId: this.nextId(),
      sequence: this.sequence,
      clock: this.clock(),
      type: 'transcript.final',
      binding: this.binding,
      utteranceId,
      revision: 1,
      text: '',
      language: this.config.language ?? 'und',
      audioInterval: { startMs: 0, endMs: 0 },
    };
    this.emit(final);
  }

  async write(frame: SpeechInputFrame): Promise<void> {
    if (this.settled) throw new MistralTranscriptionError('closed', 'session is closed');
    if (!isValidSpeechAudioFrame(frame) || frame.type !== 'audio.input') {
      throw new MistralTranscriptionError('invalid-format', 'audio.input frame failed validation');
    }
    if (frame.format.codec !== TRANSCRIPTION_FORMAT.codec
      || frame.format.sampleRateHz !== TRANSCRIPTION_FORMAT.sampleRateHz
      || frame.format.channels !== TRANSCRIPTION_FORMAT.channels) {
      throw new MistralTranscriptionError('invalid-format', 'only pcm16-le 24kHz mono is admitted');
    }
    // Refused audio is never metered: the utterance checks run before the
    // reservation, and a failed stream open rolls the reservation back.
    const open = this.current;
    if (open && !open.abandoned && !open.donePending && open.utteranceId !== frame.utteranceId) {
      throw new MistralTranscriptionError('invalid-format', 'new utteranceId requires a committed or cleared turn');
    }
    if (this.finalizedIds.has(frame.utteranceId)) {
      throw new MistralTranscriptionError('invalid-format', 'utteranceId already finalized');
    }
    if (monotonicNow(this.nowMs) - this.openedAtMs >= this.effectiveMaxMs) {
      throw new MistralTranscriptionError('ceiling', 'session duration bound reached');
    }
    const seconds = frame.sampleCount / frame.format.sampleRateHz;
    if (!(seconds > 0) || this.audioSeconds + seconds > this.admission.ceiling.admittedAudioSeconds) {
      throw new MistralTranscriptionError('ceiling', 'admitted audio ceiling reached');
    }
    this.audioSeconds += seconds;
    let stream = this.current;
    if (!stream || stream.abandoned || stream.donePending) {
      try {
        stream = await this.openStream(frame.utteranceId, frame.capturedAtMs);
      } catch (error) {
        this.audioSeconds -= seconds;
        throw error;
      }
      if (this.settled) {
        stream.abandoned = true;
        this.audioSeconds -= seconds;
        await stream.socket.close().catch(() => undefined);
        throw new MistralTranscriptionError('closed', 'session is closed');
      }
    }
    // Capture-domain turn window for the final's audioInterval. The window
    // lives on the per-turn stream, so a later turn can never stretch it.
    if (Number.isFinite(frame.capturedAtMs) && frame.capturedAtMs >= 0) {
      stream.audioEndMs = frame.capturedAtMs + (frame.sampleCount / frame.format.sampleRateHz) * 1000;
    }
    // The payload is encoded and released here; the adapter retains only counters.
    const audio = base64Of(frame.payload);
    stream.socket.send(JSON.stringify({ type: 'input_audio.append', audio }));
  }

  async command(command: Parameters<SpeechSession['command']>[0]): Promise<void> {
    if (this.settled && command.type !== 'session.close') {
      throw new MistralTranscriptionError('closed', 'session is closed');
    }
    switch (command.type) {
      case 'input.commit': {
        if (monotonicNow(this.nowMs) - this.openedAtMs >= this.effectiveMaxMs) {
          throw new MistralTranscriptionError('ceiling', 'session duration bound reached');
        }
        // Re-committing a finalized turn is an idempotent no-op: no second
        // final, no usage record. The record stays single per utteranceId.
        if (this.finalizedIds.has(command.utteranceId)) return;
        const stream = this.current;
        if (!stream || stream.abandoned) {
          this.emitEmptyFinal(command.utteranceId);
          await this.recordUsage();
          return;
        }
        if (stream.donePending) {
          throw new MistralTranscriptionError('invalid-format', 'turn already committed');
        }
        if (stream.utteranceId !== command.utteranceId) {
          throw new MistralTranscriptionError('invalid-format', 'commit for a turn with no open audio');
        }
        stream.donePending = true;
        stream.socket.send(JSON.stringify({ type: 'input_audio.end' }));
        await this.recordUsage();
        // The final was emitted by onDone before this resolves; an
        // abandonment (clear/close/error) resolves with no final.
        await stream.donePromise;
        return;
      }
      case 'input.clear': {
        // Mistral exposes no buffer clear: abandon the open provider stream
        // so late frames cannot resurrect the turn, and reopen lazily.
        const stream = this.current;
        if (stream && !stream.abandoned && stream.utteranceId === command.utteranceId) {
          stream.abandoned = true;
          stream.resolveDone(undefined);
          if (this.current === stream) this.current = undefined;
          await stream.socket.close();
        }
        return;
      }
      case 'session.mute': {
        // Mute is enforced by capture (no audio written); the cloud adapter holds no gate.
        return;
      }
      case 'session.close': {
        await this.close();
        return;
      }
      default: {
        throw new MistralTranscriptionError('unsupported-command', 'not applicable to STT-only transcription');
      }
    }
  }

  async close(): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    this.expiryCancel?.();
    this.expiryCancel = undefined;
    if (this.signal && this.abortHandler) this.signal.removeEventListener('abort', this.abortHandler);
    const stream = this.current;
    this.current = undefined;
    if (stream && !stream.abandoned) {
      stream.abandoned = true;
      stream.resolveDone(undefined);
    }
    try {
      if (stream) await stream.socket.close();
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
      if (this.pumps === 0) await Promise.allSettled([...this.pumpPromises]);
    }
  }

  private trackPump(promise: Promise<void>): void {
    this.pumpPromises.add(promise);
    void promise.finally(() => {
      this.pumpPromises.delete(promise);
    });
  }

  private makeStream(
    socket: MistralTranscriptionSocket,
    utteranceId: string,
    audioStartMs: number,
    resolveReady: () => void,
    rejectReady: (error: unknown) => void,
  ): TurnStream {
    let resolveDone!: (text: string | undefined) => void;
    const donePromise = new Promise<string | undefined>((resolve) => {
      resolveDone = resolve;
    });
    const stream: TurnStream = {
      socket,
      utteranceId,
      audioStartMs,
      audioEndMs: audioStartMs,
      text: '',
      revision: 0,
      donePending: false,
      abandoned: false,
      doneReceived: false,
      resolveDone,
      donePromise,
    };
    this.trackPump(this.runTurn(stream, resolveReady, rejectReady));
    return stream;
  }

  private async openStream(utteranceId: string, audioStartMs: number): Promise<TurnStream> {
    let socket: MistralTranscriptionSocket;
    try {
      socket = await this.openProviderStream();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown';
      throw new MistralTranscriptionError('transport', `provider connect failed: ${this.redact(detail)}`);
    }
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    // The pump resolves once `session.created` arrives; a close ends the
    // socket iteration, so this never awaits past the session teardown.
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const stream = this.makeStream(socket, utteranceId, audioStartMs, resolveReady, rejectReady);
    try {
      // The update leaves only after the provider created the session.
      await readyPromise;
      socket.send(JSON.stringify(buildMistralSessionUpdate(this.config)));
    } catch (error) {
      stream.abandoned = true;
      await socket.close().catch(() => undefined);
      if (error instanceof MistralTranscriptionError) throw error;
      const detail = error instanceof Error ? error.message : 'unknown';
      throw new MistralTranscriptionError('transport', `session update failed: ${this.redact(detail)}`);
    }
    const open = this.current;
    if (open && open !== stream && !open.abandoned && !open.donePending) {
      // A concurrent write opened a usable stream first: drop this one.
      stream.abandoned = true;
      stream.resolveDone(undefined);
      await socket.close().catch(() => undefined);
      return open;
    }
    this.current = stream;
    return stream;
  }

  private async runTurn(
    stream: TurnStream,
    resolveReady: () => void,
    rejectReady: (error: unknown) => void,
  ): Promise<void> {
    this.pumps += 1;
    try {
      const iterator = stream.socket.messages()[Symbol.asyncIterator]();
      // Phase 1: the provider opens with `session.created`; anything else
      // first is a protocol violation and the stream never becomes current.
      for (;;) {
        const next = await iterator.next();
        if (next.done) {
          rejectReady(new MistralTranscriptionError('transport', 'provider closed before session.created'));
          return;
        }
        let first: unknown;
        try {
          first = JSON.parse(next.value) as unknown;
        } catch {
          rejectReady(new MistralTranscriptionError('transport', 'provider sent a non-JSON frame'));
          return;
        }
        if (typeof first === 'object' && first !== null
          && (first as Record<string, unknown>).type === 'session.created') {
          resolveReady();
          break;
        }
        rejectReady(new MistralTranscriptionError('transport', 'expected session.created first'));
        return;
      }
      // Phase 2: turn frames until the done, an abandonment, or the close.
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        if (this.settled || stream.abandoned) return;
        this.onFrame(stream, next.value);
        if (stream.doneReceived) {
          await stream.socket.close().catch(() => undefined);
          return;
        }
      }
    } catch (error) {
      rejectReady(error);
      if (!this.settled && !stream.abandoned) {
        this.outcome = 'failed';
        this.pushError('transport', false);
        void this.close();
      }
    } finally {
      this.pumps -= 1;
    }
  }

  private onDelta(stream: TurnStream, text: string): void {
    if (stream.abandoned || stream.doneReceived) return;
    // Deltas are final on arrival (no correction pass): append only.
    const start = stream.text.length;
    stream.text += text;
    stream.revision += 1;
    this.sequence += 1;
    const partial: SpeechTranscriptPartial = {
      schemaVersion: 1,
      speechSessionId: this.receipt.speechSessionId,
      connectionEpoch: this.receipt.connectionEpoch,
      eventId: this.nextId(),
      sequence: this.sequence,
      clock: this.clock(),
      type: 'transcript.partial',
      binding: this.binding,
      utteranceId: stream.utteranceId,
      revision: stream.revision,
      replaces: { start, end: start },
      text,
    };
    this.emit(partial);
  }

  private onDone(stream: TurnStream, text: string, language: unknown): void {
    if (stream.abandoned) return;
    this.finalizedIds.add(stream.utteranceId);
    if (stream.doneReceived) {
      this.pushError('invalid-format', true);
      return;
    }
    stream.doneReceived = true;
    stream.revision += 1;
    this.sequence += 1;
    let resolved = this.config.language ?? 'und';
    if (!this.config.language && typeof language === 'string' && language) resolved = language;
    const final: SpeechTranscriptFinal = {
      schemaVersion: 1,
      speechSessionId: this.receipt.speechSessionId,
      connectionEpoch: this.receipt.connectionEpoch,
      eventId: this.nextId(),
      sequence: this.sequence,
      clock: this.clock(),
      type: 'transcript.final',
      binding: this.binding,
      utteranceId: stream.utteranceId,
      revision: stream.revision,
      text,
      language: resolved,
      audioInterval: { startMs: stream.audioStartMs, endMs: stream.audioEndMs },
    };
    if (this.current === stream) this.current = undefined;
    stream.resolveDone(text);
    // The turn stream served its single turn; teardown is best-effort.
    void stream.socket.close().catch(() => undefined);
    this.emit(final);
  }

  private onFrame(stream: TurnStream, raw: string): void {
    if (this.settled || stream.abandoned) return;
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
    const record = frame as Record<string, unknown>;
    if (record.type === 'session.updated' || record.type === 'session.created'
      || record.type === 'transcription.segment'
      || (typeof record.type === 'string' && record.type.startsWith('turn.'))) {
      // Acks, diarized segments (diarize stays off) and turn events (server
      // turn detection stays off): tolerated for forward compatibility.
      return;
    }
    if (record.type === 'transcription.text.delta') {
      if (typeof record.text !== 'string') {
        this.pushError('invalid-format', true);
        return;
      }
      this.onDelta(stream, record.text);
      return;
    }
    if (record.type === 'transcription.done') {
      if (typeof record.text !== 'string') {
        this.pushError('invalid-format', true);
        return;
      }
      this.onDone(stream, record.text, record.language);
      return;
    }
    if (record.type === 'error') {
      // The turn is over: drop it so a late done cannot resurrect it.
      stream.abandoned = true;
      stream.resolveDone(undefined);
      if (this.current === stream) this.current = undefined;
      void stream.socket.close().catch(() => undefined);
      this.pushError('provider-error', false);
      return;
    }
    // Unknown provider event types are tolerated (forward compatibility); the stream continues.
  }
}

/**
 * Redact the bearer token from any message before it reaches an error.
 * A provider that echoes the Authorization header must never leak it through
 * session events or thrown errors.
 */
const redactBearer = (message: string, token: string): string => {
  if (!token) return message;
  return message.split(`Bearer ${token}`).join('Bearer [REDACTED]').split(token).join('[REDACTED]');
};

/**
 * Open an admitted transcription session. No provider contact happens here:
 * each client turn opens its own stream lazily at the first write, since
 * `input_audio.end` finishes the provider session. The bearer token travels
 * only into the per-turn socket handshakes; failures never echo it. An
 * aborted signal refuses without connecting.
 */
export const openMistralTranscriptionSession = async (
  config: MistralTranscriptionProfileConfig,
  options: MistralTranscriptionOpenOptions,
): Promise<MistralTranscriptionSession> => {
  const capabilities = mistralTranscriptionCapabilities(config);
  const binding: SpeechBinding = {
    ...mistralTranscriptionIdentity(config),
    ...(config.language ? { language: config.language } : {}),
    ...(config.accountRef ? { accountRef: config.accountRef } : {}),
  };
  assertAdmission(options.admission);
  if (!isNonEmptyString(options.bearerToken)) {
    throw new MistralTranscriptionError('invalid-config', 'bearer token is required');
  }
  const { request } = options;
  // TTS bindings are refused here (fail-closed): synthesis is selected
  // separately on the Mistral TTS binding, never through this adapter.
  if (request.pipeline !== 'chained' || request.bindings.stt === undefined
    || request.bindings.stt.providerId !== binding.providerId
    || request.bindings.stt.modelId !== binding.modelId
    || request.bindings.tts !== undefined) {
    throw new MistralTranscriptionError('invalid-config', 'STT-only chained binding for this profile is required');
  }
  for (const format of [...(request.inputFormats ?? []), ...(request.outputFormats ?? [])]) {
    if (format.codec !== TRANSCRIPTION_FORMAT.codec || format.sampleRateHz !== TRANSCRIPTION_FORMAT.sampleRateHz
      || format.channels !== TRANSCRIPTION_FORMAT.channels) {
      throw new MistralTranscriptionError('invalid-config', 'only pcm16-le 24kHz mono is supported');
    }
  }
  if (options.signal?.aborted) {
    throw new MistralTranscriptionError('aborted', 'open aborted before connect');
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
  // Bind the handshake (URL + authorization) once: per-turn dials reuse it.
  // The session holds no key: failures are redacted through this closure.
  const bearerToken = options.bearerToken;
  const openProviderStream = async (): Promise<MistralTranscriptionSocket> =>
    options.connect(MISTRAL_TRANSCRIPTION_WS_URL, {
      authorization: `Bearer ${bearerToken}`,
      originator: options.originator ?? 'sentropic-llm-mesh',
    });
  const redact = (message: string): string => redactBearer(message, bearerToken);
  return new MistralTranscriptionSession(
    receipt, binding, options.admission, options.usage, config, openProviderStream, redact,
    options.nowMs, options.signal, options.schedule, request.maxDurationMs,
  );
};
