// Profile pin tests (r3 L3): independent tiny/base pins, fail closed with no default.
import { describe, expect, it } from 'vitest';
import { LOCAL_STT_PROFILES, selectLocalSttProfile, UnknownSpeechProfileError } from '../src/node/profiles.js';

describe('model selection', () => {
  it('should pin independent tiny/base profiles with distinct models', () => {
    expect(LOCAL_STT_PROFILES.map((profile) => profile.profileId)).toEqual(['local-tiny', 'local-base']);
    const tinyProfile = selectLocalSttProfile('local-tiny');
    const baseProfile = selectLocalSttProfile('local-base');
    expect(tinyProfile.model.modelId).toBe('tiny');
    expect(baseProfile.model.modelId).toBe('base');
    expect(tinyProfile.model.modelDigest).not.toBe(baseProfile.model.modelDigest);
    expect(tinyProfile.windowSec).toBeLessThan(baseProfile.windowSec);
    expect(tinyProfile.model.engineVersion).toBe('1.2.1');
  });

  it('should fail closed on unknown profiles with no default model', () => {
    for (const name of ['', 'tiny', 'local-small', 'LOCAL-TINY']) {
      expect(() => selectLocalSttProfile(name)).toThrow(UnknownSpeechProfileError);
    }
  });
});
