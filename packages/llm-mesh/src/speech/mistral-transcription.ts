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
  Number.isSafeInteger(value) && ((value >= MISTRAL_TRANSCRIPTION_DELAY_MIN_MS
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
  private readonly connect: MistralTranscriptionConnect;
  private readonly bearerToken: string;
  private readonly originator: string;
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
  private usageRevision = 0;

  constructor(
    receipt: SpeechSessionReceipt,
    binding: SpeechBinding,
    admission: MistralTranscriptionAdmission,
    usage: MistralTranscriptionUsageSink,
    config: MistralTranscriptionProfileConfig,
    connect: MistralTranscriptionConnect,
    bearerToken: string,
    originator: string | undefined,
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
    this.connect = connect;
    this.bearerToken = bearerToken;
    this.originator = originator ?? 'sentropic-llm-mesh';
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

