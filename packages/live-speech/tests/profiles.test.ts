// Profile pin tests (r3 L3): independent pins, per-file digests, provenance,
// forced-endpoint bound, fail closed with no default.
import { describe, expect, it } from 'vitest';
import { LOCAL_STT_PROFILES, selectLocalSttProfile, UnknownSpeechProfileError } from '../src/node/profiles.js';

describe('model selection', () => {
  it('should pin independent tiny/base profiles with distinct models', () => {
    expect(LOCAL_STT_PROFILES.map((profile) => profile.profileId)).toEqual(['local-tiny', 'local-base']);
    const tinyProfile = selectLocalSttProfile('local-tiny');
    const baseProfile = selectLocalSttProfile('local-base');
    expect(tinyProfile.model.modelId).toBe('tiny');
    expect(baseProfile.model.modelId).toBe('base');
    expect(tinyProfile.model.files.modelBin).not.toBe(baseProfile.model.files.modelBin);
    expect(tinyProfile.windowSec).toBeLessThan(baseProfile.windowSec);
    expect(tinyProfile.model.engineVersion).toBe('1.2.1');
  });

  it('should pin every loaded file plus origin, revision and license', () => {
    for (const profile of LOCAL_STT_PROFILES) {
      expect(profile.model.origin).toMatch(/^https:\/\/huggingface\.co\/Systran\/faster-whisper-/);
      expect(profile.model.modelRevision).toMatch(/^[0-9a-f]{40}$/);
      expect(profile.model.license).toBe('MIT');
      expect(profile.model.modelDirName).toBe(`faster-whisper-${profile.model.modelId}`);
      for (const digest of Object.values(profile.model.files)) {
        expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
      expect(profile.model.vadDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(profile.maxUtteranceSec).toBeGreaterThan(profile.windowSec);
    }
    // The old faster-whisper repo SHA is not a model revision.
    expect(selectLocalSttProfile('local-tiny').model.modelRevision).not.toBe('d2ee195a9a093a4e0cc81553beb2f8e6ced9ebb8');
  });

  it('should fail closed on unknown profiles with no default model', () => {
    for (const name of ['', 'tiny', 'local-small', 'LOCAL-TINY']) {
      expect(() => selectLocalSttProfile(name)).toThrow(UnknownSpeechProfileError);
    }
  });
});
