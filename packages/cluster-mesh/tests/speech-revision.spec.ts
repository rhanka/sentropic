import { describe, expect, it } from 'vitest';
import { resolveSpeechProfiles } from '../src/speech/config.js';
import { projectSpeechProfile } from '../src/speech/projection.js';
import { context, engine, profile } from './speech-fixtures.js';

describe('speech revision content', () => {
  it('should pin canonical content regardless of object key order', () => {
    const p = profile();
    const first = resolveSpeechProfiles([p])[0];
    const reordered = Object.fromEntries(Object.entries(p).reverse());
    const second = resolveSpeechProfiles([reordered])[0];
    expect(first.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.contentDigest).toBe(first.contentDigest);
    expect(resolveSpeechProfiles([{ ...p, micMode: 'open-mic' }])[0].contentDigest).not.toBe(first.contentDigest);
    expect(resolveSpeechProfiles([p], [first])[0].contentDigest).toBe(first.contentDigest);
  });
  it('should refuse a reloaded revision with different bindings outside rebind', () => {
    const previous = resolveSpeechProfiles([profile()]);
    const changed = { ...profile(), bindings: { ...profile().bindings, stt: engine('base') } };
    const reloaded = resolveSpeechProfiles([changed]);
    expect(projectSpeechProfile(previous, previous[0], context()).available).toBe(true);
    expect(projectSpeechProfile(reloaded, previous[0], context()))
      .toMatchObject({ available: false, reason: 'revision' });
    expect(() => resolveSpeechProfiles([changed], previous)).toThrow(/speech/i);
    expect(resolveSpeechProfiles([{ ...changed, configRevision: 'r2' }], previous)).toHaveLength(1);
  });
  it('should expose the pinned digest and refuse selections without that pin', () => {
    const profiles = resolveSpeechProfiles([profile()]);
    expect(projectSpeechProfile(profiles, profiles[0], context()))
      .toMatchObject({ available: true, contentDigest: profiles[0].contentDigest });
    expect(projectSpeechProfile(profiles, { ...profiles[0], contentDigest: '' }, context()))
      .toMatchObject({ available: false, reason: 'revision' });
  });
});
