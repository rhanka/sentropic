import { describe, expect, it } from 'vitest';
import { resolveSpeechProfiles } from '../src/speech/config.js';
import { projectSpeechProfile, rebindSpeechProfile } from '../src/speech/projection.js';
import { capabilities, catalogue, consent, context, engine, primary, profile, select } from './speech-fixtures.js';

const config = () => resolveSpeechProfiles(primary);
describe('speech projection', () => {
  it.each(primary)('should project selected $profileId with exact revision and microphone off', (p) => {
    const result = projectSpeechProfile(config(), select(p.profileId), context());
    expect(result).toMatchObject({ available: true, schemaVersion: 1, micEnabled: false,
      requiresSessionAdmission: true, profile: { profileId: p.profileId, configRevision: 'r1' } });
  });
  it('should project a local snapshot without an online app and expose blocked cloud profiles', () => {
    const offline = { ...context(), online: false };
    expect(projectSpeechProfile(config(), select(), offline).available).toBe(true);
    expect(projectSpeechProfile(config(), select('C'), offline)).toMatchObject({ available: false, reason: 'offline' });
  });
  it('should never choose a fallback even when an ordered one is configured', () => {
    const profiles = resolveSpeechProfiles([{ ...primary[0], fallbacks: [select('B')] }, primary[1]]);
    const ctx = { ...context(), catalogue: catalogue.filter((c) => c.binding.modelId !== 'tiny') };
    expect(projectSpeechProfile(profiles, select(), ctx)).toMatchObject({ available: false, reason: 'unavailable' });
    expect(projectSpeechProfile(profiles, select('B'), ctx).available).toBe(true);
    expect(projectSpeechProfile(profiles, select('A', 'stale'), ctx)).toMatchObject({ available: false, reason: 'profile' });
  });
  it.each([
    ['tenant', { tenantId: 'other' }], ['tenant', { workspaceId: 'other' }],
    ['policy', { policyRef: 'other' }], ['policy', { budgetRef: 'other' }],
    ['policy', { egressPolicyRef: 'other' }], ['placement', { allowedPlacements: [] }],
    ['egress', { allowedEgress: ['device'] }],
  ] as const)('should refuse an unauthorized projection with %s', (reason, overrides) => {
    expect(projectSpeechProfile(config(), select('C'), { ...context(), ...overrides }))
      .toMatchObject({ available: false, reason });
  });
  it('should refuse unqualified capability, selector, codec and route evidence', () => {
    const p = profile(); const stt = capabilities(p.bindings.stt!);
    for (const support of ['unknown', 'unsupported', 'partial'] as const) {
      const ctx = { ...context(), catalogue: [{ ...stt, features: { ...stt.features, streamingStt: support } },
        ...catalogue.filter((c) => c.binding.modelId !== 'tiny')] };
      expect(projectSpeechProfile(config(), select(), ctx)).toMatchObject({ available: false, reason: 'capability' });
    }
    const check = (changed: object) => projectSpeechProfile(resolveSpeechProfiles([{ ...p, ...changed }]), select(), context());
    expect(check({ bindings: { ...p.bindings, stt: { ...p.bindings.stt, language: 'unqualified' } } }))
      .toMatchObject({ available: false, reason: 'selector' });
    expect(check({ inputFormats: [{ codec: 'opus', sampleRateHz: 48000, channels: 1 }] }))
      .toMatchObject({ available: false, reason: 'format' });
    expect(projectSpeechProfile(config(), select(), { ...context(), inspectRoute: () => ({ available: false }) }))
      .toMatchObject({ available: false, reason: 'route' });
  });
  it('should support independently evidenced duplex and every declared placement', () => {
    for (const placement of profile().allowedPlacements) {
      const duplex = engine('native-model', 'future', placement, 'native-adapter');
      const p = { ...profile(), placement, pipeline: 'native-duplex', micMode: 'open-mic',
        bindings: { duplex }, requiredCapabilities: {} };
      expect(projectSpeechProfile(resolveSpeechProfiles([p]), select(), {
        ...context(), catalogue: [capabilities(duplex)],
      })).toMatchObject({ available: true, micEnabled: false, profile: { pipeline: 'native-duplex', placement } });
    }
  });
  it('should permit rebind only after the explicit cancellation barrier and renewed bound consent', () => {
    const current = projectSpeechProfile(config(), select(), context());
    if (!current.available) throw new Error('fixture unavailable');
    const barrier = { expectedConfigRevision: 'r1', quiescent: true, cancelled: true,
      reconciled: true, playbackDrained: true, previousConsentRevision: 'consent:original', consent: consent() };
    expect(rebindSpeechProfile(current, config(), select('B'), context(), barrier))
      .toMatchObject({ available: true, micEnabled: false, profile: { profileId: 'B' } });
    for (const field of ['quiescent', 'cancelled', 'reconciled', 'playbackDrained'] as const) {
      expect(rebindSpeechProfile(current, config(), select('B'), context(), { ...barrier, [field]: false }))
        .toMatchObject({ available: false, reason: 'busy' });
    }
    for (const c of [undefined, consent('A'), consent('B', 'old'), { ...consent(), egressPolicyRef: 'old' },
      { ...consent(), consentRevision: 'consent:original' }]) {
      expect(rebindSpeechProfile(current, config(), select('B'), context(), {
        ...barrier, previousConsentRevision: 'consent:original', consent: c,
      })).toMatchObject({ available: false, reason: 'consent' });
    }
    expect(rebindSpeechProfile(current, config(), select('B'), context(), { ...barrier, expectedConfigRevision: 'old' }))
      .toMatchObject({ available: false, reason: 'revision' });
  });
  it('should isolate snapshot bytes and refuse ambiguous catalogue evidence', () => {
    const ctx = context();
    const result = projectSpeechProfile(config(), select(), ctx);
    if (!result.available) throw new Error('fixture unavailable');
    expect(Object.isFrozen(result.stages.stt?.capabilities.features)).toBe(true);
    expect(Object.isFrozen(ctx.catalogue[0].features)).toBe(false);
    expect(result.stages.stt?.negotiated.binding.resourceRef).toBe('resource:endpoint');
    expect(projectSpeechProfile(config(), select(), { ...ctx, catalogue: [...catalogue, catalogue[0]] }))
      .toMatchObject({ available: false, reason: 'unavailable' });
  });
  it('should refuse same-revision edits and cross-tenant rebind even at quiescence', () => {
    const current = projectSpeechProfile(config(), select(), context());
    if (!current.available) throw new Error('fixture unavailable');
    const changed = resolveSpeechProfiles([{ ...primary[0], micMode: 'open-mic' }]);
    const barrier = { expectedConfigRevision: 'r1', quiescent: true, cancelled: true, reconciled: true,
      playbackDrained: true, previousConsentRevision: 'original', consent: consent('A') };
    expect(rebindSpeechProfile(current, changed, select(), context(), barrier))
      .toMatchObject({ available: false, reason: 'revision' });
    expect(rebindSpeechProfile(current, config(), select('B'), { ...context(), tenantId: 'other' }, barrier))
      .toMatchObject({ available: false, reason: 'tenant' });
    const revised = resolveSpeechProfiles([{ ...primary[0], configRevision: 'r2', micMode: 'open-mic' }]);
    expect(rebindSpeechProfile(current, revised, select('A', 'r2'), context(), {
      ...barrier, consent: consent('A', 'r2'),
    })).toMatchObject({ available: true, micEnabled: false, profile: { configRevision: 'r2', micMode: 'open-mic' } });
  });
});
