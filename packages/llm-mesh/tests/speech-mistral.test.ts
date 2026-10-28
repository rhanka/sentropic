// Mistral streaming STT + TTS binding (L13 gate): endpoint/final mapping,
// cancel/flush, no double count, late-frame suppression, Bearer redaction,
// per-turn windows. Recorded fixtures only; no live call.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  /** Provider-side close: the stream ends without further frames. */
  end(): void {
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

describe('mistral profile and session.update', () => {
  it('should pin the 3.0 realtime model and refuse the 2602 generation', () => {
    const capabilities = mistralTranscriptionCapabilities(sttConfig);
    expect(capabilities.binding).toMatchObject({ providerId: 'mistral', modelId: 'voxtral-mini-transcribe-realtime-3' });
    expect(() => mistralTranscriptionCapabilities({ ...sttConfig, modelId: 'voxtral-mini-transcribe-realtime-2602' as never }))
      .toThrowError(MistralTranscriptionError);
  });

  it('should build the exact session.update body', () => {
    expect(buildMistralSessionUpdate(sttConfig)).toEqual({
      type: 'session.update',
      session: {
        audio_format: { encoding: 'pcm_s16le', sample_rate: 24000 },
        target_streaming_delay_ms: 480,
        language: 'fr',
      },
    });
  });

  it('should bound the streaming delay and the language code', () => {
    for (const delay of [80, 1200, 2400]) {
      expect(() => mistralTranscriptionCapabilities({ ...sttConfig, targetStreamingDelayMs: delay })).not.toThrow();
    }
    for (const delay of [79, 1201, 2399, 2401, Number.NaN]) {
      expect(() => mistralTranscriptionCapabilities({ ...sttConfig, targetStreamingDelayMs: delay as number }))
        .toThrowError(/targetStreamingDelayMs/);
    }
    expect(() => mistralTranscriptionCapabilities({ ...sttConfig, language: 'fra' })).toThrowError(/language/);
    expect(() => mistralTranscriptionCapabilities({ ...sttConfig, turnDetection: 'server' as never }))
      .toThrowError(/turn detection/);
    expect(() => mistralTranscriptionCapabilities({ ...sttConfig, modelRevision: '' })).toThrowError(/modelRevision/);
  });

  it('should refuse TTS selection on the STT profile', async () => {
    const capabilities = mistralTranscriptionCapabilities(sttConfig);
    expect(capabilities.features.tts).toBe('unsupported');
    expect(capabilities.features.serverVad).toBe('unsupported');
    const driven = await openMistralDriven();
    await expect(openMistralTranscriptionSession(sttConfig, {
      request: { ...sessionRequest(), bindings: { stt: sttBinding(), tts: { ...sttBinding(), modelId: 'voxtral-mini-tts-3-0' } } },
      admission: admission(),
      bearerToken: 'bearer-fixture',
      connect: async () => new GateSocket(),
      usage: new RecordingSink(),
    })).rejects.toMatchObject({ code: 'invalid-config' });
    await driven.session.close();
  });
});

describe('mistral TTS binding', () => {
  it('should expose the pinned TTS selection without an implicit voice', () => {
    const capabilities = mistralTtsCapabilities('tts-rev-1', 'fr');
    expect(capabilities.binding).toMatchObject({ providerId: 'mistral', modelId: 'voxtral-mini-tts-3-0' });
    expect(capabilities.features.tts).toBe('supported');
    expect(capabilities.features.streamingStt).toBe('unsupported');
    expect(capabilities.usageUnits).toEqual(['characters']);
    expect(capabilities.voices).toContain('voice_592');
    expect(capabilities.languages).toEqual(['fr']);
    // No implicit voice: an explicit voice_id is required at request build.
    expect(() => buildMistralTtsRequest({ voiceId: 'voice_592', input: '', responseFormat: 'mp3', maxInputCharacters: 100 }))
      .toThrowError(/non-empty/);
  });

  it('should negotiate documented voices and refuse unknown selectors', () => {
    const capabilities = mistralTtsCapabilities('tts-rev-1');
    expect(capabilities.voices).toHaveLength(mistralTtsVoices.length);
    const accepted = negotiateSpeech(capabilities, {
      binding: { ...capabilities.binding, voice: 'voice_592', language: 'fr' },
      required: ['tts'],
    });
    expect(accepted).toMatchObject({ ok: true });
    expect(negotiateSpeech(capabilities, {
      binding: { ...capabilities.binding, voice: 'voice_unknown' },
      required: ['tts'],
    })).toEqual({ ok: false, reason: 'selector', selector: 'voice' });
    // No documented API region: an explicit region refuses fail-closed.
    expect(negotiateSpeech(capabilities, {
      binding: { ...capabilities.binding, voice: 'voice_592', region: 'eu' },
      required: ['tts'],
    })).toEqual({ ok: false, reason: 'selector', selector: 'region' });
    expect(negotiateSpeech(capabilities, {
      binding: capabilities.binding,
      required: ['streamingStt'],
    })).toMatchObject({ ok: false, reason: 'capability', capability: 'streamingStt' });
  });

  it('should build the exact speech request body', () => {
    expect(buildMistralTtsRequest({ voiceId: 'voice_592', input: 'Bonjour.', responseFormat: 'mp3', maxInputCharacters: 100 })).toEqual({
      model: 'voxtral-mini-tts-3-0',
      input: 'Bonjour.',
      voice_id: 'voice_592',
      response_format: 'mp3',
    });
    expect(() => buildMistralTtsRequest({ voiceId: 'voice_unknown', input: 'Hi.', responseFormat: 'mp3', maxInputCharacters: 100 }))
      .toThrowError(/unknown.*voice/);
    expect(() => buildMistralTtsRequest({ voiceId: 'voice_592', input: 'Hi.', responseFormat: 'ogg' as never, maxInputCharacters: 100 }))
      .toThrowError(/responseFormat/);
  });

  it('should bound TTS input by the admitted character ceiling', () => {
    // `pcm` covers the advertised pcm16-le output format.
    expect(buildMistralTtsRequest({ voiceId: 'voice_592', input: 'Bonjour.', responseFormat: 'pcm', maxInputCharacters: 100 }))
      .toMatchObject({ response_format: 'pcm' });
    expect(() => buildMistralTtsRequest({ voiceId: 'voice_592', input: 'Too long.', responseFormat: 'mp3', maxInputCharacters: 3 }))
      .toThrowError(/admitted 3 characters/);
    expect(() => buildMistralTtsRequest({ voiceId: 'voice_592', input: 'Hi.', responseFormat: 'mp3', maxInputCharacters: 0 }))
      .toThrowError(/positive ceiling/);
  });
});

describe('mistral transcript mapping', () => {
  it('should emit ordered partials then a final from the done record', async () => {
    const driven = await openMistralDriven();
    await driven.write('u1', 10);
    driven.lastSocket().push(...frameScriptFr);
    const events = await driven.collect();
    const partials = events.filter((event) => event.type === 'transcript.partial');
    const finals = events.filter((event) => event.type === 'transcript.final');
    expect(partials.map((event) => (event as { revision: number }).revision)).toEqual([1, 2]);
    expect(partials.map((event) => (event as { utteranceId: string }).utteranceId)).toEqual(['u1', 'u1']);
    expect(partials.map((event) => (event as { replaces: unknown }).replaces)).toEqual([
      { start: 0, end: 0 }, { start: 9, end: 9 },
    ]);
    expect(finals).toHaveLength(1);
    const final = finals[0] as unknown as Record<string, unknown>;
    expect(final.utteranceId).toBe('u1');
    expect(final.text).toBe("Bonjour, pouvez-vous m'entendre ?");
    expect(final.language).toBe('fr');
    expect(final.revision).toBe(3);
    expect(final.audioInterval).toEqual({ startMs: 10, endMs: 30 });
    let rebuilt: SpeechTranscript | undefined;
    for (const event of events) {
      if (event.type === 'transcript.partial' || event.type === 'transcript.final') {
        rebuilt = reviseSpeechTranscript(rebuilt, event as SpeechTranscript) ?? rebuilt;
      }
    }
    expect(rebuilt?.text).toBe(final.text);
  });

  it('should keep one provider stream per turn with per-turn windows', async () => {
    // A later turn must not stretch the earlier final: the window lives on
    // the per-turn stream, and each turn re-sends session.update.
    const driven = await openMistralDriven();
    await driven.write('u_a', 10);
    await driven.commit('u_a', [frameDelta('premier '), frameDone('premier tour')]);
    await driven.write('u_b', 100);
    await driven.commit('u_b', [frameDelta('second '), frameDone('second tour')]);
    const events = await driven.collect();
    const finals = events
      .filter((event) => event.type === 'transcript.final')
      .map((event) => {
        const final = event as unknown as { utteranceId: string; text: string; revision: number; audioInterval: unknown };
        return { utteranceId: final.utteranceId, text: final.text, revision: final.revision, audioInterval: final.audioInterval };
      });
    expect(finals).toEqual([
      { utteranceId: 'u_a', text: 'premier tour', revision: 2, audioInterval: { startMs: 10, endMs: 30 } },
      { utteranceId: 'u_b', text: 'second tour', revision: 2, audioInterval: { startMs: 100, endMs: 120 } },
    ]);
    expect(driven.sockets).toHaveLength(2);
    expect(driven.connects.map((entry) => entry.url)).toEqual([MISTRAL_TRANSCRIPTION_WS_URL, MISTRAL_TRANSCRIPTION_WS_URL]);
    expect(driven.connects[0]?.headers.authorization).toBe('Bearer bearer-fixture');
    for (const socket of driven.sockets) {
      expect(JSON.parse(socket.sent[0] as string)).toMatchObject({ type: 'session.update' });
    }
  });

  it('should emit an empty final for a commit with no audio', async () => {
    const driven = await openMistralDriven();
    await driven.commit('u_empty');
    const events = await driven.collect();
    const finals = events.filter((event) => event.type === 'transcript.final');
    expect(finals).toHaveLength(1);
    const final = finals[0] as unknown as Record<string, unknown>;
    expect(final.utteranceId).toBe('u_empty');
    expect(final.text).toBe('');
    expect(final.revision).toBe(1);
    expect(final.audioInterval).toEqual({ startMs: 0, endMs: 0 });
    expect(driven.sockets).toHaveLength(0);
    expect(driven.sink.records).toHaveLength(1);
  });

  it('should let the done language fill in when the profile sets none', async () => {
    const driven = await openMistralDriven({ ...sttConfig, language: undefined });
    await driven.write('u_en', 20);
    driven.lastSocket().push(...frameScriptAppended);
    const events = await driven.collect();
    const final = events.find((event) => event.type === 'transcript.final') as unknown as Record<string, unknown>;
    expect(final?.utteranceId).toBe('u_en');
    expect(final?.text).toBe('Hello, world');
    // No language anywhere: the final stays explicitly unknown.
    expect(final?.language).toBe('und');
  });

  it('should surface invalid frames as error events and continue the stream', async () => {
    const driven = await openMistralDriven();
    await driven.write('u_ok', 10);
    driven.lastSocket().push(...frameScriptInvalid);
    const events = await driven.collect();
    const errors = events.filter((event) => event.type === 'error');
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatchObject({ reason: 'invalid-format', retryable: true });
    const final = events.find((event) => event.type === 'transcript.final') as unknown as Record<string, unknown>;
    expect(final?.utteranceId).toBe('u_ok');
    expect(final?.text).toBe('kept going');
  });

  it('should emit the record when done arrives without a commit', async () => {
    // A spontaneous provider done ends the turn: the final is emitted, and a
    // follow-up write under the same id is refused — the next turn uses u2.
    const driven = await openMistralDriven();
    await driven.write('u1', 10);
    driven.lastSocket().push(frameDelta('one '), frameDone('one'));
    await flush();
    await expect(driven.session.write(frame('u1', 50))).rejects.toMatchObject({
      code: 'invalid-format', message: expect.stringContaining('already finalized'),
    });
    await driven.write('u2', 50);
    await driven.commit('u2', [frameDelta('two'), frameDone('two')]);
    const events = await driven.collect();
    const finals = events
      .filter((event) => event.type === 'transcript.final')
      .map((event) => `${(event as unknown as { utteranceId: string }).utteranceId}:${(event as unknown as { text: string }).text}`);
    expect(finals).toEqual(['u1:one', 'u2:two']);
    expect(driven.sockets).toHaveLength(2);
  });

  it('should emit exactly one final on double commit', async () => {
    const driven = await openMistralDriven();
    await driven.write('u1', 10);
    await driven.commit('u1', [frameDone('one')]);
    await driven.session.command(commitCommand('u1'));
    const events = await driven.collect();
    const finals = events.filter((event) => event.type === 'transcript.final');
    expect(finals).toHaveLength(1);
    expect(driven.sink.records).toHaveLength(1);
  });

  it('should refuse a write that races a pending commit on the same id', async () => {
    const driven = await openMistralDriven();
    await driven.write('u1', 10);
    const pending = driven.session.command(commitCommand('u1'));
    await flush();
    // A late capture frame after Stop must not open a second u1 stream.
    await expect(driven.write('u1', 20)).rejects.toMatchObject({ code: 'invalid-format' });
    expect(driven.sockets).toHaveLength(1);
    driven.lastSocket().push(frameDone('one'));
    await pending;
    await driven.write('u2', 100);
    expect(driven.sockets).toHaveLength(2);
    await driven.commit('u2', [frameDone('two')]);
    const events = await driven.collect();
    const finals = events
      .filter((event) => event.type === 'transcript.final')
      .map((event) => `${(event as unknown as { utteranceId: string }).utteranceId}:${(event as unknown as { text: string }).text}`);
    expect(finals).toEqual(['u1:one', 'u2:two']);
  });

  it('should emit one final with no partials when done carries the whole turn', async () => {
    const driven = await openMistralDriven();
    await driven.write('u_solo', 10);
    await driven.commit('u_solo', [frameDone('solo')]);
    const events = await driven.collect();
    expect(events.filter((event) => event.type === 'transcript.partial')).toHaveLength(0);
    const finals = events.filter((event) => event.type === 'transcript.final');
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ utteranceId: 'u_solo', text: 'solo', revision: 1 });
  });

  it('should end a pending commit when the provider closes without done', async () => {
    const driven = await openMistralDriven();
    await driven.write('u1', 10);
    const pending = driven.session.command(commitCommand('u1'));
    await flush();
    driven.lastSocket().end();
    await pending;
    // The dead turn resolves with a transport error and no final; the next
    // turn opens a fresh stream on the still-open session.
    await driven.write('u2', 100);
    expect(driven.sockets).toHaveLength(2);
    await driven.commit('u2', [frameDone('second')]);
    const events = await driven.collect();
    expect(events
      .filter((event) => event.type === 'transcript.final')
      .map((event) => (event as unknown as { utteranceId: string }).utteranceId)).toEqual(['u2']);
    expect(events.filter((event) => event.type === 'error')).toMatchObject([{ reason: 'transport' }]);
  });

  it('should close while a stream is still opening', async () => {
    // The provider never answers with session.created: close() must tear the
    // opening socket down instead of joining a pump that waits forever.
    const socket = new GateSocket();
    const session = await openMistralTranscriptionSession(sttConfig, {
      request: sessionRequest(),
      admission: admission(),
      bearerToken: 'bearer-fixture',
      connect: async () => socket,
      usage: new RecordingSink(),
      schedule: () => () => undefined,
    });
    const pendingWrite = session.write(frame('u1', 10));
    await flush(50);
    await session.close();
    await expect(pendingWrite).rejects.toMatchObject({ code: 'transport' });
    expect(socket.closed).toBe(true);
  });

  it('should emit no second final when committing after a spontaneous done', async () => {
    const driven = await openMistralDriven();
    await driven.write('u1', 10);
    driven.lastSocket().push(frameDone('one'));
    await flush();
    await driven.session.command(commitCommand('u1'));
    const events = await driven.collect();
    const finals = events
      .filter((event) => event.type === 'transcript.final')
      .map((event) => (event as unknown as { text: string }).text);
    expect(finals).toEqual(['one']);
    expect(driven.sink.records).toHaveLength(0);
  });

  it('should drop the turn on provider error and continue the session', async () => {
    const driven = await openMistralDriven();
    await driven.write('u1', 10);
    driven.lastSocket().push(frameDelta('lost '), frameError('boom'));
    await flush();
    await driven.write('u2', 100);
    await driven.commit('u2', [frameDone('second')]);
    const events = await driven.collect();
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(events.find((event) => event.type === 'error')).toMatchObject({ reason: 'provider-error', retryable: false });
    const finals = events
      .filter((event) => event.type === 'transcript.final')
      .map((event) => (event as unknown as { utteranceId: string; text: string }).utteranceId);
    expect(finals).toEqual(['u2']);
  });

  it('should never settle the opaque done usage block', async () => {
    // The done record carries a provider usage block with no revision
    // semantics: the final is emitted, but settle carries no usage.
    const driven = await openMistralDriven();
    await driven.write('u1', 10);
    await driven.commit('u1', frameScriptDoneWithUsage);
    await driven.session.close();
    expect(driven.sink.settles).toEqual([{ operationId: 'op-1', outcome: 'completed' }]);
  });
});

describe('mistral session lifecycle', () => {
  it('should wait for session.created before sending session.update', async () => {
    const socket = new GateSocket();
    let connected = 0;
    const session = await openMistralTranscriptionSession(sttConfig, {
      request: sessionRequest(),
      admission: admission(),
      bearerToken: 'bearer-fixture',
      connect: async () => {
        connected += 1;
        return socket;
      },
      usage: new RecordingSink(),
      schedule: () => () => undefined,
    });
    const pending = session.write(frame('u1', 10));
    await flush();
    // Created has not arrived: no update on the wire yet.
    expect(socket.sent).toHaveLength(0);
    socket.push(frameCreated());
    await pending;
    expect(socket.sent).toHaveLength(2);
    expect(JSON.parse(socket.sent[0] as string)).toMatchObject({ type: 'session.update' });
    expect(JSON.parse(socket.sent[1] as string)).toMatchObject({ type: 'input_audio.append' });
    expect(connected).toBe(1);
    await session.close();
  });

  it('should refuse a stream that does not open with session.created', async () => {
    const socket = new GateSocket([frameDelta('early')]);
    const session = await openMistralTranscriptionSession(sttConfig, {
      request: sessionRequest(),
      admission: admission(),
      bearerToken: 'bearer-fixture',
      connect: async () => socket,
      usage: new RecordingSink(),
      schedule: () => () => undefined,
    });
    try {
      await expect(session.write(frame('u1', 10))).rejects.toMatchObject({ code: 'transport' });
    } finally {
      await session.close();
    }
  });

  it('should refuse a served model outside the 3.0 preview generation', async () => {
    const socket = new GateSocket([frameCreated('voxtral-mini-transcribe-realtime-2602')]);
    const sink = new RecordingSink();
    const session = await openMistralTranscriptionSession(sttConfig, {
      request: sessionRequest(),
      admission: admission(),
      bearerToken: 'bearer-fixture',
      connect: async () => socket,
      usage: sink,
      schedule: () => () => undefined,
    });
    try {
      await expect(session.write(frame('u1', 10))).rejects.toMatchObject({ code: 'transport' });
      // The refused stream never became current and metered nothing.
      await expect(session.write(frame('u1', 10))).rejects.toMatchObject({ code: 'transport' });
      expect(sink.records).toHaveLength(0);
    } finally {
      await session.close();
    }
  });

  it('should refuse to connect when the signal is already aborted', async () => {
    let connected = 0;
    const controller = new AbortController();
    controller.abort();
    await expect(openMistralTranscriptionSession(sttConfig, {
      request: sessionRequest(),
      admission: admission(),
      bearerToken: 'bearer-fixture',
      connect: async () => {
        connected += 1;
        return new GateSocket();
      },
      usage: new RecordingSink(),
      signal: controller.signal,
      schedule: () => () => undefined,
    })).rejects.toMatchObject({ code: 'aborted' });
    expect(connected).toBe(0);
  });

  it('should close the socket and settle cancelled on abort', async () => {
    const socket = new GateSocket([frameCreated()]);
    const sink = new RecordingSink();
    const controller = new AbortController();
    const session = await openMistralTranscriptionSession(sttConfig, {
      request: sessionRequest(),
      admission: admission(),
      bearerToken: 'bearer-fixture',
      connect: async () => socket,
      usage: sink,
      signal: controller.signal,
      schedule: () => () => undefined,
    });
    await session.write(frame('u1', 10));
    controller.abort();
    await flush();
    expect(socket.closed).toBe(true);
    expect(sink.settles).toEqual([{ operationId: 'op-1', outcome: 'cancelled' }]);
    await expect(session.write(frame('u2', 30))).rejects.toMatchObject({ code: 'closed' });
    await session.close();
  });

  it('should enforce maxDurationMs with an injectable scheduler', async () => {
    const driven = await openMistralDriven(sttConfig, {
      admission: admission({ maxDurationMs: 500 }),
    });
    expect(driven.expiries).toHaveLength(1);
    expect(driven.expiries[0]?.ms).toBe(500);
    await driven.write('u1', 10);
    driven.advance(600);
    await expect(driven.session.write(frame('u2', 30))).rejects.toMatchObject({ code: 'ceiling' });
    await expect(driven.session.command(commitCommand('u2'))).rejects.toMatchObject({ code: 'ceiling' });
    driven.expiries[0]?.fn();
    await flush();
    expect(driven.lastSocket().closed).toBe(true);
    expect(driven.sink.settles).toEqual([{ operationId: 'op-1', outcome: 'cancelled' }]);
  });

  it('should record cumulative totals under a stable eventId', async () => {
    const driven = await openMistralDriven();
    await driven.write('u1', 10);
    await driven.commit('u1', [frameDone('one')]);
    await driven.write('u2', 30);
    await driven.commit('u2', [frameDone('two')]);
    expect(driven.sink.records).toEqual([
      {
        eventId: 'op-1:audio', revision: 0, mode: 'cumulative',
        usage: { admittedAudioSeconds: 0.02, connectedSeconds: 0 },
      },
      {
        eventId: 'op-1:audio', revision: 1, mode: 'cumulative',
        usage: { admittedAudioSeconds: 0.04, connectedSeconds: 0 },
      },
    ]);
    await driven.session.close();
    expect(driven.sink.settles).toEqual([{ operationId: 'op-1', outcome: 'completed' }]);
  });

  it('should meter audio seconds and refuse past the admitted ceiling', async () => {
    const driven = await openMistralDriven(sttConfig, {
      admission: admission({ ceiling: { connectedSeconds: 60, admittedAudioSeconds: 0.03 } }),
    });
    await driven.session.write(frame('u1', 10, 480));
    expect(driven.lastSocket().sent.filter((message) => JSON.parse(message).type === 'input_audio.append')).toHaveLength(1);
    await expect(driven.session.write(frame('u1', 30, 480))).rejects.toMatchObject({ code: 'ceiling' });
    // The commit still ends the admitted turn; the done confirms it.
    const sealing = driven.session.command(commitCommand('u1'));
    await flush();
    driven.lastSocket().push(frameDone(''));
    await sealing;
    expect(JSON.stringify(driven.sink)).not.toContain('transcript');
    await driven.session.close();
  });

  it('should abandon the turn on clear and drop its late frames', async () => {
    const driven = await openMistralDriven();
    await driven.write('u_drop', 10);
    const dropped = driven.lastSocket();
    await driven.session.command(clearCommand('u_drop'));
    expect(dropped.closed).toBe(true);
    // The late done for the cleared turn arrives on the abandoned stream.
    dropped.push(frameDone('dropped transcript'));
    await flush();
    await driven.write('u3', 100);
    await driven.commit('u3', [frameDone('third turn')]);
    const events = await driven.collect();
    const finals = events.filter((event) => event.type === 'transcript.final');
    expect(finals).toHaveLength(1);
    const final = finals[0] as unknown as Record<string, unknown>;
    expect(final?.utteranceId).toBe('u3');
    expect(final?.text).toBe('third turn');
    expect(final?.audioInterval).toEqual({ startMs: 100, endMs: 120 });
    expect(events.filter((event) => event.type === 'error')).toHaveLength(0);
  });

  it('should resolve a pending commit with no final when cleared or closed', async () => {
    const driven = await openMistralDriven();
    await driven.write('u1', 10);
    const pending = driven.session.command(commitCommand('u1'));
    await flush();
    await driven.session.command(clearCommand('u1'));
    await pending;
    const events = await driven.collect();
    expect(events.filter((event) => event.type === 'transcript.final')).toHaveLength(0);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(0);
    expect(driven.sink.settles).toEqual([{ operationId: 'op-1', outcome: 'completed' }]);
  });

  it('should suppress frames that arrive after close', async () => {
    // The held frames are released from inside close(), after the session
    // settled: without the settled guards they would surface as events.
    const socket = new PostCloseSocket([frameCreated()]);
    const driven = await openMistralDriven(sttConfig, { connect: async () => socket });
    await driven.session.write(frame('u1', 10));
    socket.push(frameDelta('late but open'));
    await flush();
    socket.hold(frameDelta('after close'), frameDone('after close'));
    await driven.session.close();
    expect(socket.closed).toBe(true);
    const out: SpeechEvent[] = [];
    for await (const event of driven.session.events) out.push(event);
    expect(out.filter((event) => event.type === 'transcript.partial')).toHaveLength(1);
    expect(out.filter((event) => event.type === 'transcript.final')).toHaveLength(0);
    expect(out.filter((event) => event.type === 'error')).toHaveLength(0);
    expect(driven.sink.settles).toEqual([{ operationId: 'op-1', outcome: 'completed' }]);
  });

  it('should keep profiles independent on separate sockets and sinks', async () => {
    const enConfig: MistralTranscriptionProfileConfig = {
      modelId: 'voxtral-mini-transcribe-realtime-3',
      modelRevision: 'rev-3-2026-10-28',
      targetStreamingDelayMs: 2400,
    };
    const [fr, en] = await Promise.all([openMistralDriven(sttConfig), openMistralDriven(enConfig)]);
    await fr.write('u_fr', 10);
    await fr.commit('u_fr', frameScriptFr);
    await en.write('u_en', 10);
    await en.commit('u_en', [frameDone('hello')]);
    const [frEvents, enEvents] = await Promise.all([fr.collect(), en.collect()]);
    expect(frEvents.filter((event) => event.type === 'transcript.final')).toHaveLength(1);
    expect(enEvents.filter((event) => event.type === 'transcript.final')).toHaveLength(1);
    expect(fr.sockets).not.toBe(en.sockets);
    expect(JSON.parse(en.sockets[0].sent[0]).session).not.toHaveProperty('language');
    expect(fr.sink.settles).toHaveLength(1);
    expect(en.sink.settles).toHaveLength(1);
  });

  it('should redact the Bearer [REDACTED] from failures and store no audio', async () => {
    const token = 'bearer-secret-fixture';
    const failingConnect = async () => {
      throw new Error("provider connect failed (status 401, Bearer " + token + ")");
    };
    const session = await openMistralTranscriptionSession(sttConfig, {
      request: sessionRequest(),
      admission: admission(),
      bearerToken: token,
      connect: failingConnect,
      usage: new RecordingSink(),
      schedule: () => () => undefined,
    });
    try {
      await session.write(frame('u1', 10, 24));
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(token);
      expect(String(error)).toContain('[REDACTED]');
    } finally {
      await session.close();
    }
    const driven = await openMistralDriven(sttConfig, { bearerToken: token });
    await driven.write('u1', 10);
    await driven.commit('u1', [frameDone('one')]);
    const appends = driven.lastSocket().sent.filter((message) => JSON.parse(message).type === 'input_audio.append');
    expect(appends).toHaveLength(1);
    expect(JSON.parse(appends[0]).audio).toBe('A'.repeat(1280));
    expect(driven.session).not.toHaveProperty('bearerToken');
    expect(JSON.stringify(driven.sink)).not.toContain('transcript');
    await driven.session.close();
  });
  it('should refuse utteranceId switches without a boundary', async () => {
    const driven = await openMistralDriven();
    await driven.write('u1', 10);
    await expect(driven.session.write(frame('u2', 30))).rejects.toMatchObject({ code: 'invalid-format' });
    await expect(driven.session.command(commitCommand('u2'))).rejects.toMatchObject({ code: 'invalid-format' });
    await driven.commit('u1', [frameDone('one')]);
    const events = await driven.collect();
    expect(events.filter((event) => event.type === 'transcript.final')).toHaveLength(1);
    // The refused switch was never metered: only the accepted frame counts.
    expect(driven.sink.records).toEqual([
      {
        eventId: 'op-1:audio', revision: 0, mode: 'cumulative',
        usage: { admittedAudioSeconds: 0.02, connectedSeconds: 0 },
      },
    ]);
  });

  it('should keep the G-CLOUD receipt blocked and never claim live evidence', () => {
    const receiptPath = fileURLToPath(new URL('../bench/l13-mistral.receipt.json', import.meta.url));
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      status: string;
      missing: Array<{ item: string; status: string }>;
      license: Record<string, string>;
      priceList: Record<string, string>;
    };
    expect(receipt.status).toBe('blocked');
    for (const item of receipt.missing) {
      expect(item.status).toBe('blocked');
    }
    // License/price separation per generation: the 2602 generation stays
    // not admitted and differs from the 3.0 preview entries.
    expect(receipt.license['voxtral-2602']).toMatch(/not admitted/);
    expect(receipt.priceList['voxtral-2602']).toMatch(/not admitted/);
    expect(receipt.license['voxtral-3-preview']).not.toBe(receipt.license['voxtral-2602']);
    expect(receipt.priceList['voxtral-3-preview']).not.toBe(receipt.priceList['voxtral-2602']);
  });
});
