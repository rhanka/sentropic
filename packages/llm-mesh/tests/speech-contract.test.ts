import { describe, expect, expectTypeOf, it } from 'vitest';
import { getModelProfile, getModelSpeechCapabilities } from '../src/catalog.js';
import { isValidSpeechAudioFrame, type SpeechInputFrame, type SpeechTranscript } from '../src/speech/contracts.js';
import {
  negotiateSpeech, speechCapabilityNames, type SpeechCapabilities,
} from '../src/speech/capabilities.js';

const pcm = { codec: 'pcm16-le', sampleRateHz: 24000, channels: 1 } as const;
const binding = {
  providerId: 'local', modelId: 'tiny', modelRevision: 'sha256:fixture',
  adapterId: 'fixture', adapterRevision: '1', placement: 'endpoint-native',
} as const;
const capabilities: SpeechCapabilities = {
  binding,
  features: Object.fromEntries(speechCapabilityNames.map((name) => [name, 'supported'])) as SpeechCapabilities['features'],
  inputFormats: [pcm], outputFormats: [pcm], usageUnits: ['audio-seconds'],
};
const request = {
  binding, required: ['streamingStt', 'partialTranscript'] as const,
  inputFormats: [pcm], outputFormats: [pcm],
};
const frame: SpeechInputFrame = {
  type: 'audio.input', schemaVersion: 1, speechSessionId: 'speech-1',
  connectionEpoch: 2, eventId: 'frame-1', sequence: 0,
  clock: { id: 'capture', monotonicMs: 12 },
  streamId: 'mic', utteranceId: 'u1', capturedAtMs: 10,
  sampleCount: 480, format: pcm, payload: new Uint8Array(960),
};

describe('speech contract v1', () => {
  it('should select the first mutually supported exact media format', () => {
    const other = { ...pcm, sampleRateHz: 16000 } as const;
    expect(negotiateSpeech(capabilities, { ...request, inputFormats: [other, pcm] })).toEqual({
      ok: true, binding, inputFormat: pcm, outputFormat: pcm,
    });
  });

  it.each(['unknown', 'unsupported', 'partial'] as const)(
    'should refuse required capabilities when support is %s', (support) => {
      expect(negotiateSpeech({ ...capabilities, features: {
        ...capabilities.features, partialTranscript: support,
      } }, request)).toEqual({ ok: false, reason: 'capability', capability: 'partialTranscript', support });
    },
  );

  it('should refuse absent capabilities rather than inherit provider support', () => {
    expect(negotiateSpeech(undefined, request)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it.each(['providerId', 'modelId', 'modelRevision', 'adapterId', 'adapterRevision', 'placement'] as const)(
    'should refuse another %s without implicit fallback', (field) => {
      const mismatched = { ...binding, [field]: 'different' };
      expect(negotiateSpeech(capabilities, { ...request, binding: mismatched as typeof binding }))
        .toEqual({ ok: false, reason: 'identity' });
    },
  );

  it.each(['input', 'output'] as const)('should refuse incompatible %s media', (direction) => {
    const formats = [{ ...pcm, sampleRateHz: 48000 }] as const;
    expect(negotiateSpeech(capabilities, { ...request, [`${direction}Formats`]: formats }))
      .toEqual({ ok: false, reason: 'format', direction });
  });

  it('should accept binary PCM metadata with exact sample accounting', () => {
    expect(isValidSpeechAudioFrame(frame)).toBe(true);
    expect(isValidSpeechAudioFrame({ ...frame, type: 'audio.output',
      responseId: 'response', outputItemId: 'item', turnId: 'turn',
      turnEpoch: 1, sampleOffset: 0,
    })).toBe(true);
  });

  it.each([
    { sequence: -1 }, { sampleCount: 1.5 }, { connectionEpoch: NaN },
    { payload: new Uint8Array(959) }, { capturedAtMs: -1 },
    { format: { ...pcm, channels: 2 } }, { clock: { id: 'capture', monotonicMs: Infinity } },
  ])('should reject invalid binary metadata: %j', (invalid) => {
    expect(isValidSpeechAudioFrame({ ...frame, ...invalid } as SpeechInputFrame)).toBe(false);
  });

  it('should express replacement hypotheses and immutable final projections separately', () => {
    const partial: SpeechTranscript = {
      ...frame, type: 'transcript.partial', binding, utteranceId: 'u1', revision: 2,
      replaces: { start: 0, end: 5 }, text: 'bonjour',
    };
    const final: SpeechTranscript = {
      ...frame, type: 'transcript.final', binding, utteranceId: 'u1', revision: 3,
      text: 'bonjour !', language: 'fr', audioInterval: { startMs: 0, endMs: 400 },
    };
    expect(partial.replaces).toEqual({ start: 0, end: 5 });
    expect(final.revision).toBeGreaterThan(partial.revision);
    expectTypeOf(final).not.toHaveProperty('replaces');
    expectTypeOf(final.text).toEqualTypeOf<string>();
  });

  it('should preserve existing text capabilities and leave speech unqualified', () => {
    const text = getModelProfile('openai', 'gpt-6.1-sol');
    expect(text?.capabilities.modalities.output).toEqual(['text', 'json', 'tool-call']);
    expect(getModelSpeechCapabilities('openai', 'gpt-6.1-sol')).toBeUndefined();
    expect(getModelSpeechCapabilities('openai', 'not-in-catalog')).toBeUndefined();
  });
});
