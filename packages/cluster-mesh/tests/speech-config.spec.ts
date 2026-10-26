import { describe, expect, it } from 'vitest';
import { resolveClusterMeshConfig } from '../src/config.js';
import { resolveSpeechProfiles } from '../src/speech/config.js';
import { engine, primary, profile } from './speech-fixtures.js';

describe('speech configuration', () => {
  it('should preserve all primary tuples and the second local engine without defaults', () => {
    const config = resolveClusterMeshConfig({ capacity: { poolSize: 1 }, speechProfiles: primary });
    expect(config.speechProfiles).toHaveLength(6);
    expect(config.speechProfiles?.map((p) => p.bindings.stt?.modelId))
      .toEqual(['tiny', 'base', 'gpt-live-transcribe', 'gpt-realtime-whisper', 'voxtral-realtime-3', 'tiny']);
    expect(config.speechProfiles?.every((p) => p.fallbacks.length === 0)).toBe(true);
    expect(resolveClusterMeshConfig({ capacity: { poolSize: 1 } })).toEqual({
      capacity: { poolSize: 1, maxConcurrent: 12 },
    });
  });
  it.each(['endpoint-native', 'browser-wasm', 'local-companion', 'cluster-hosted', 'cloud-relay'] as const)(
    'should allow an evidenced future provider at %s without a provider allowlist', (placement) => {
      const p = { ...profile(), placement, micMode: 'open-mic',
        bindings: { stt: engine('future-model', 'future-provider', placement, 'future-adapter'),
          tts: engine('future-voice', 'future-provider', placement, 'future-adapter') } };
      expect(resolveSpeechProfiles([p])[0]).toMatchObject(p);
    });
  it('should preserve native duplex independently from chained stage choices', () => {
    const p = { ...profile(), pipeline: 'native-duplex',
      bindings: { duplex: engine('native-model', 'future', 'cloud-relay', 'duplex') } };
    expect(resolveSpeechProfiles([p])[0]).toMatchObject(p);
  });
  it('should clone and freeze configuration instead of enabling microphone capture', () => {
    const p = profile(); const resolved = resolveSpeechProfiles([p]);
    Reflect.set(p.bindings.stt!, 'modelId', 'changed');
    expect(resolved[0].bindings.stt?.modelId).toBe('tiny');
    expect(Object.isFrozen(resolved[0].bindings.stt)).toBe(true);
    expect(JSON.stringify(resolved)).not.toContain('micEnabled');
  });
  it.each([
    null, {}, { ...profile(), schemaVersion: 2 }, { ...profile(), micMode: 'always' },
    { ...profile(), placement: 'remote-unknown' }, { ...profile(), bindings: { stt: engine() } },
    { ...profile(), bindings: { ...profile().bindings, duplex: engine() } },
    { ...profile(), maxDurationMs: 0 }, { ...profile(), maxCostUsd: Number.NaN },
    { ...profile(), bindings: { ...profile().bindings, stt: { ...engine(), modelRevision: 'latest' } } },
    { ...profile(), requiredCapabilities: { stt: ['hallucinated'] } },
    { ...profile(), inputFormats: [] }, { ...profile(), inputFormats: [{ codec: 'pcm16-le', channels: 2, sampleRateHz: 16000 }] },
    { ...profile(), allowedPlacements: [] }, { ...profile(), allowedEgress: ['anything'] },
  ])('should refuse malformed configuration without leaking its payload', (candidate) => {
    expect(() => resolveSpeechProfiles([candidate])).toThrow(/speech/i);
  });
  it.each([
    { ...profile(), apiKey: 'sensitive-value' }, { ...profile(), micEnabled: true },
    { ...profile(), bindings: { ...profile().bindings, stt: { ...engine(), token: 'sensitive-value' } } },
    { ...profile(), inputFormats: [{ ...profile().inputFormats[0], secret: 'sensitive-value' }] },
  ])('should refuse secret or activation fields at any schema boundary', (candidate) => {
    expect(() => resolveSpeechProfiles([candidate])).toThrow(/speech/i);
    try { resolveSpeechProfiles([candidate]); } catch (error) {
      expect(String(error)).not.toContain('sensitive-value');
    }
  });
  it('should preserve fallback order and reject unresolved or duplicate identities', () => {
    const a = { ...profile(), fallbacks: [{ profileId: 'B', configRevision: 'r1' }] };
    expect(resolveSpeechProfiles([a, primary[1]])[0].fallbacks).toEqual(a.fallbacks);
    expect(() => resolveSpeechProfiles([a])).toThrow(/speech/i);
    expect(() => resolveSpeechProfiles([profile(), profile()])).toThrow(/speech/i);
    expect(() => resolveSpeechProfiles([{ ...a, fallbacks: [{ profileId: 'A', configRevision: 'r1' }] }])).toThrow(/speech/i);
  });
});
