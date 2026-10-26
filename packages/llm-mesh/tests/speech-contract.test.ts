import { describe, expect, it } from 'vitest';
import { getModelProfile, listModelProfiles, getModelSpeechCapabilities } from '../src/catalog.js';
import { isValidSpeechAudioFrame, reviseSpeechTranscript, type SpeechInputFrame, type SpeechTranscript } from '../src/speech/contracts.js';
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

  it('should apply partial replacements, refuse stale or invalid revisions and freeze finals', () => {
    const partial: SpeechTranscript = {
      ...frame, type: 'transcript.partial', binding, utteranceId: 'u1', revision: 1,
      replaces: { start: 0, end: 0 }, text: 'bonjur',
    };
    const final: SpeechTranscript = {
      ...frame, type: 'transcript.final', binding, utteranceId: 'u1', revision: 3,
      text: 'bonjour !', language: 'fr', audioInterval: { startMs: 0, endMs: 400 },
    };
    const first = reviseSpeechTranscript(undefined, partial);
    const revision = { ...partial, revision: 2, replaces: { start: 4, end: 4 }, text: 'o' };
    const revised = reviseSpeechTranscript(first, revision);
    expect(revised?.text).toBe('bonjour');
    expect(reviseSpeechTranscript(revised, partial)).toBe(revised);
    expect(reviseSpeechTranscript(first, { ...revision, replaces: { start: 0, end: 99 } })).toBe(first);
    expect(reviseSpeechTranscript(first, { ...revision, utteranceId: 'other' })).toBe(first);
    const committed = reviseSpeechTranscript(revised, final);
    expect(committed?.text).toBe('bonjour !');
    expect(reviseSpeechTranscript(committed, { ...revision, revision: 4 })).toBe(committed);
    expect(reviseSpeechTranscript(committed, { ...final, revision: 4, text: 'changed' })).toBe(committed);
  });

  it('should preserve existing text capabilities and leave speech unqualified', () => {
    const text = getModelProfile('openai', 'gpt-6.1-sol');
    expect(text?.capabilities.modalities.output).toEqual(['text', 'json', 'tool-call']);
    for (const model of listModelProfiles()) {
      expect(model.capabilities).not.toHaveProperty('speech');
      expect(model.capabilities.modalities.output).toEqual(['text', 'json', 'tool-call']);
      expect(getModelSpeechCapabilities(model.providerId, model.modelId)).toEqual([]);
    }
    expect(getModelSpeechCapabilities('openai', 'not-in-catalog')).toEqual([]);
  });

  it('should list every adapter and placement for speech-only engines independently of LLMs', () => {
    const matrix: SpeechCapabilities[] = ['faster-whisper-ts', 'whisper.cpp'].flatMap((adapterId) =>
      ['endpoint-native', 'local-companion', 'cluster-hosted', 'cloud-relay', 'browser-wasm'].map((placement) => ({
        ...capabilities, binding: { ...binding, adapterId, placement: placement as typeof binding.placement },
      })));
    const other = { ...capabilities, binding: { ...binding, providerId: 'other-vendor' } };
    const revised = { ...capabilities, binding: { ...binding, modelRevision: 'sha256:new', adapterRevision: '2' } };
    const catalogue = [...matrix, other, revised];
    expect(getModelSpeechCapabilities('local', 'tiny', catalogue)).toEqual([...matrix, revised]);
    expect(getModelSpeechCapabilities('other-vendor', 'tiny', catalogue)).toEqual([other]);
    expect(getModelSpeechCapabilities('missing', 'tiny', catalogue)).toEqual([]);
    expect(listModelProfiles().some((model) => String(model.modelId) === 'tiny')).toBe(false);
  });

  it.each(['fr', 'en'])('should negotiate %s with tenant references kept for gateway admission', (language) => {
    const selected = { ...binding, language, voice: 'v1', region: 'eu', accountRef: 'account', resourceRef: 'resource' };
    expect(negotiateSpeech({ ...capabilities, languages: ['fr', 'en'], voices: ['v1'], regions: ['eu'] },
      { ...request, binding: selected })).toEqual({ ok: true, binding: selected, inputFormat: pcm, outputFormat: pcm });
  });

  it.each(['language', 'voice', 'region'] as const)('should refuse an unsupported %s selector', (selector) => {
    expect(negotiateSpeech({ ...capabilities, languages: ['fr', 'en'], voices: ['v1'], regions: ['eu'] },
      { ...request, binding: { ...binding, [selector]: 'unqualified' } }))
      .toEqual({ ok: false, reason: 'selector', selector });
    expect(negotiateSpeech(capabilities, { ...request, binding: { ...binding, [selector]: 'unqualified' } }))
      .toEqual({ ok: false, reason: 'selector', selector });
  });

  it('should negotiate output-only Opus without requiring input media', () => {
    const opus = { ...pcm, codec: 'opus' } as const;
    expect(negotiateSpeech({ ...capabilities, outputFormats: [opus] },
      { binding, required: ['tts'], outputFormats: [opus, pcm] }))
      .toEqual({ ok: true, binding, outputFormat: opus });
  });

  it('should refuse missing feature evidence as unknown', () => {
    const { partialTranscript: _, ...features } = capabilities.features;
    expect(negotiateSpeech({ ...capabilities, features } as SpeechCapabilities, request))
      .toEqual({ ok: false, reason: 'capability', capability: 'partialTranscript', support: 'unknown' });
  });
});
