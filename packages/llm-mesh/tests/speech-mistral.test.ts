// Mistral streaming STT + TTS binding (L13 gate): endpoint/final mapping,
// cancel/flush, no double count, late-frame suppression, Bearer redaction,
// per-turn windows. Recorded fixtures only; no live call.
import { describe, expect, it } from 'vitest';
import {
  negotiateSpeech,
} from '../src/speech/capabilities.js';
import {
  reviseSpeechTranscript,
  type SpeechEvent,
  type SpeechInputFrame,
  type SpeechSession,
  type SpeechSessionRequest,
  type SpeechTranscript,
} from '../src/speech/contracts.js';
import {
  buildMistralSessionUpdate,
  buildMistralTtsRequest,
  mistralTranscriptionCapabilities,
  mistralTtsCapabilities,
  mistralTtsVoices,
  MistralTranscriptionError,
  openMistralTranscriptionSession,
  MISTRAL_TRANSCRIPTION_WS_URL,
  type MistralTranscriptionConnect,
  type MistralTranscriptionProfileConfig,
  type MistralTranscriptionSocket,
  type MistralTranscriptionUsageSink,
} from '../src/speech/mistral-transcription.js';
import {
  frameCreated,
  frameDelta,
  frameDone,
  frameError,
  frameScriptAppended,
  frameScriptDoneWithUsage,
  frameScriptFr,
  frameScriptInvalid,
} from './fixtures/mistral-frames.js';

const sttConfig: MistralTranscriptionProfileConfig = {
  modelId: 'voxtral-mini-transcribe-realtime-3',
  modelRevision: 'rev-3-2026-10-28',
  targetStreamingDelayMs: 480,
  language: 'fr',
};

const admission = (overrides: Record<string, unknown> = {}) => ({
  operationId: 'op-1',
  holdRef: 'hold-1',
  pricingRevision: 'price-r1',
  ceiling: { connectedSeconds: 60, admittedAudioSeconds: 60 },
  maxDurationMs: 60_000,
  ...overrides,
});

const sttBinding = () => ({
  providerId: 'mistral',
  modelId: 'voxtral-mini-transcribe-realtime-3',
  modelRevision: 'rev-3-2026-10-28',
  adapterId: 'mistral-transcription',
  adapterRevision: '1',
  placement: 'cloud-relay' as const,
});

const sessionRequest = (): SpeechSessionRequest => ({
  protocolVersion: 1,
  configuration: { profileId: 'mistral-voxtral-realtime-3', configRevision: 'cfg-r1', policyRef: 'policy' },
  target: { sessionId: 'agent-1', sourceGeneration: 'boot-1', controllerEpoch: 3, consentRevision: 'consent-1' },
  pipeline: 'chained',
  micMode: 'key',
  bindings: { stt: sttBinding() },
  requiredCapabilities: [],
  inputFormats: [{ codec: 'pcm16-le', sampleRateHz: 24000, channels: 1 }],
  outputFormats: [],
  maxDurationMs: 60_000,
  maxCostUsd: 1,
  budgetRef: 'budget-1',
  allowedPlacements: ['cloud-relay'],
  egressPolicyRef: 'egress-1',
});

/** Provider stream released on demand: the test drives turns, then pushes frames. */
class GateSocket implements MistralTranscriptionSocket {
  sent: string[] = [];
  closed = false;
  private frames: string[];
  private waiters: Array<() => void> = [];
  private ended = false;
  constructor(initial: readonly string[] = []) {
    this.frames = [...initial];
  }
  send(message: string): void {
    if (this.closed) throw new Error('socket closed');
    this.sent.push(message);
  }
  push(...frames: string[]): void {
    this.frames.push(...frames);
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }
  async *messages(): AsyncGenerator<string> {
    let index = 0;
    for (;;) {
      while (index < this.frames.length) yield this.frames[index++] as string;
      if (this.ended) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.ended = true;
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}

/**
 * Releases held frames from inside close(), after the session settled: models
 * a provider racing teardown. Frames pushed before close flow normally.
 */
class PostCloseSocket extends GateSocket {
  private held: string[] = [];
  hold(...frames: string[]): void {
    this.held.push(...frames);
  }
  override async close(): Promise<void> {
    this.closed = true;
    this.push(...this.held.splice(0));
    // Let the pump observe the released frames (and drop them) before close resolves.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

class RecordingSink implements MistralTranscriptionUsageSink {
  records: Array<{ eventId: string; revision: number; mode: string; usage: unknown }> = [];
  settles: Array<{ operationId: string; outcome: string; usage?: unknown; providerRevision?: number }> = [];
  record(update: { eventId: string; revision: number; mode: 'cumulative' | 'incremental'; usage: unknown }): void {
    this.records.push(update as RecordingSink['records'][number]);
  }
  settle(request: { operationId: string; outcome: 'completed' | 'cancelled' | 'failed'; usage?: unknown }): void {
    this.settles.push(request as RecordingSink['settles'][number]);
  }
}

const frame = (utteranceId: string, capturedAtMs: number, samples = 480): SpeechInputFrame => ({
  type: 'audio.input',
  schemaVersion: 1,
  speechSessionId: 'speech-op-1',
  connectionEpoch: 3,
  eventId: `cap-${capturedAtMs}`,
  sequence: capturedAtMs,
  clock: { id: 'capture', monotonicMs: capturedAtMs },
  streamId: 'mic',
  utteranceId,
  capturedAtMs,
  sampleCount: samples,
  format: { codec: 'pcm16-le', sampleRateHz: 24000, channels: 1 },
  payload: new Uint8Array(samples * 2),
});

const commitCommand = (utteranceId: string) => ({
  schemaVersion: 1 as const,
  speechSessionId: 'speech-op-1',
  connectionEpoch: 3,
  eventId: `cmd-${utteranceId}`,
  sequence: 1,
  clock: { id: 'test', monotonicMs: 1 },
  type: 'input.commit' as const,
  utteranceId,
});

const clearCommand = (utteranceId: string) => ({ ...commitCommand(`clear-${utteranceId}`), type: 'input.clear' as const, utteranceId });

const flush = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const openMistralDriven = async (config = sttConfig, overrides: Record<string, unknown> = {}) => {
  const sockets: GateSocket[] = [];
  const connects: Array<{ url: string; headers: { authorization: string; originator: string } }> = [];
  let clock = 1_000;
  const sink = new RecordingSink();
  const expiries: Array<{ ms: number; fn: () => void }> = [];
  const connect: MistralTranscriptionConnect = async (url, headers) => {
    connects.push({ url, headers });
    const socket = new GateSocket([frameCreated()]);
    sockets.push(socket);
    return socket;
  };
  const session = await openMistralTranscriptionSession(config, {
    request: sessionRequest(),
    admission: admission(),
    bearerToken: 'bearer-fixture',
    connect,
    usage: sink,
    nowMs: () => clock,
    schedule: (ms, fn) => {
      expiries.push({ ms, fn });
      return () => {
        const index = expiries.findIndex((entry) => entry.fn === fn);
        if (index >= 0) expiries.splice(index, 1);
      };
    },
    ...overrides,
  });
  const lastSocket = (): GateSocket => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error('no provider stream open');
    return socket;
  };
  return {
    session,
    sockets,
    connects,
    sink,
    expiries,
    advance: (ms: number): void => {
      clock += ms;
    },
    write: async (utteranceId: string, capturedAtMs: number, samples = 480): Promise<void> => {
      await session.write(frame(utteranceId, capturedAtMs, samples));
    },
    commit: async (utteranceId: string, done: readonly string[] = []): Promise<void> => {
      const pending = session.command(commitCommand(utteranceId));
      await flush();
      // An empty commit opens no provider stream: nothing to answer.
      if (done.length > 0) lastSocket().push(...done);
      await pending;
    },
    lastSocket,
    collect: async (): Promise<SpeechEvent[]> => {
      await flush();
      await session.close();
      const out: SpeechEvent[] = [];
      for await (const event of session.events) out.push(event);
      return out;
    },
  };
};

