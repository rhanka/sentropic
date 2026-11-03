/**
 * G1 — sharing policy: profile capability + runtime port, both default-closed
 * (converged-r2 §2.2 double lock; owner answers Q1–Q3).
 *
 * Lock 1 (deployment): `ArtifactProfileRules.allowPublicSharing`, absent ⇒ false,
 * admitted by the ruleKeys whitelist, covered by the profile digest.
 * Lock 2 (runtime, revocable): `SharingPolicyPort.getSharingPolicy(scope)`, consulted
 * in the commit transaction and at each anonymous read; absent/error/malformed ⇒ false.
 */
import { describe, expect, it } from 'vitest';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { resolveSharingPolicy, type SharingPolicyPort } from '../src/server/ports.js';

const withRule = (allowPublicSharing?: boolean) => compileArtifactsProfile({
  ...RADAR_ARTIFACTS_PROFILE,
  rules: allowPublicSharing === undefined
    ? RADAR_ARTIFACTS_PROFILE.rules
    : { ...RADAR_ARTIFACTS_PROFILE.rules, allowPublicSharing },
});

describe('profile capability lock (allowPublicSharing)', () => {
  it('defaults to closed when the key is absent', () => {
    const compiled = withRule(undefined);
    expect(compiled.rules.allowPublicSharing).toBeUndefined();
    expect(compiled.profile.rules.allowPublicSharing).toBeUndefined();
  });

  it('admits the boolean key through the ruleKeys whitelist', () => {
    expect(withRule(true).rules.allowPublicSharing).toBe(true);
    expect(withRule(false).rules.allowPublicSharing).toBe(false);
  });

  it('rejects a non-boolean value', () => {
    expect(() => compileArtifactsProfile({
      ...RADAR_ARTIFACTS_PROFILE,
      rules: { ...RADAR_ARTIFACTS_PROFILE.rules, allowPublicSharing: 'yes' as never },
    })).toThrow(/invalid profile semantics/);
  });

  it('covers the key in the profile digest', () => {
    const off = withRule(false);
    const on = withRule(true);
    const absent = withRule(undefined);
    expect(on.profileDigest).not.toBe(off.profileDigest);
    expect(off.profileDigest).not.toBe(absent.profileDigest);
    // stable across compiles
    expect(withRule(true).profileDigest).toBe(on.profileDigest);
  });
});

describe('runtime SharingPolicyPort resolution (fail-closed)', () => {
  it('returns the policy and revision when the port answers well-formed', async () => {
    const port: SharingPolicyPort = {
      getSharingPolicy: async (scope) => ({ allowPublicSharing: scope === 'open-scope', policyRevision: 'rev-7' }),
    };
    expect(await resolveSharingPolicy(port, 'open-scope')).toEqual({ allowPublicSharing: true, policyRevision: 'rev-7' });
    expect(await resolveSharingPolicy(port, 'closed-scope')).toEqual({ allowPublicSharing: false, policyRevision: 'rev-7' });
  });

  it('fails closed when the port is absent, throws, or answers malformed', async () => {
    expect(await resolveSharingPolicy(undefined, 'scope-1')).toEqual({ allowPublicSharing: false, policyRevision: 'none' });
    const throwing: SharingPolicyPort = { getSharingPolicy: async () => { throw new Error('db down'); } };
    expect(await resolveSharingPolicy(throwing, 'scope-1')).toEqual({ allowPublicSharing: false, policyRevision: 'none' });
    const malformed: SharingPolicyPort = { getSharingPolicy: async () => ({ allowPublicSharing: 'yes' }) as never };
    expect(await resolveSharingPolicy(malformed, 'scope-1')).toEqual({ allowPublicSharing: false, policyRevision: 'none' });
    const noRevision: SharingPolicyPort = { getSharingPolicy: async () => ({ allowPublicSharing: true, policyRevision: '' }) };
    expect(await resolveSharingPolicy(noRevision, 'scope-1')).toEqual({ allowPublicSharing: false, policyRevision: 'none' });
  });

  it('requires both locks for the public mode (double lock)', async () => {
    const port: SharingPolicyPort = { getSharingPolicy: async () => ({ allowPublicSharing: true, policyRevision: 'rev-1' }) };
    const runtime = await resolveSharingPolicy(port, 'scope-1');
    // profile closed ⇒ effective closed even with the runtime port open
    expect(runtime.allowPublicSharing && (withRule(undefined).rules.allowPublicSharing === true)).toBe(false);
    // both open ⇒ effective open
    expect(runtime.allowPublicSharing && (withRule(true).rules.allowPublicSharing === true)).toBe(true);
  });
});
