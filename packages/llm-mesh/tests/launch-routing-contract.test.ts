import { describe, expect, it } from 'vitest';
import { freezeLaunchRoutingContract, mappingContentSha256, launchTargets, type LaunchRoutingContract } from '../src/launch-routing-contract.js';
const exact = (): LaunchRoutingContract => ({ version: 1, revision: 'policy-1', ownerScopeRef: 'owner-a', exactModels: ['claude-opus-5-5'],
  authorizedAccountRefs: ['account-a'], rotateAccounts: false, effortPolicy: { mode: 'preserve' } });
describe('trusted launch routing contract', () => {
  it('freezes exact models, authorized accounts and rotation independently', () => {
    const input = exact(); const frozen = freezeLaunchRoutingContract(input);
    expect(frozen).toEqual(input); expect(Object.isFrozen(frozen.exactModels)).toBe(true);
    expect(launchTargets(frozen, 'claude-opus-5-5')).toBeUndefined();
    expect(() => launchTargets(frozen, 'gpt-6.1-sol')).toThrow();
  });
  it('requires explicit immutable mapping identity and verifies its content digest', () => {
    const targets = { 'claude-opus-5-5': [{ providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-4-argon', effort: 'high' }] };
    const input = { ...exact(), mapping: { id: 'g-argon-wonder', revision: '2026-10-15', contentSha256: mappingContentSha256(targets), targets } };
    const frozen = freezeLaunchRoutingContract(input);
    expect(launchTargets(frozen, 'claude-opus-5-5')![0].model).toBe('gemini-4-argon');
    targets['claude-opus-5-5'][0].model = 'other';
    expect(() => freezeLaunchRoutingContract(input)).toThrow();
    expect(launchTargets(frozen, 'claude-opus-5-5')![0].model).toBe('gemini-4-argon');
  });
  it('refuses absent, unknown, duplicated and unscoped policy fields', () => {
    for (const value of [undefined, {}, { ...exact(), unknown: true }, { ...exact(), exactModels: [] }, { ...exact(), authorizedAccountRefs: ['a', 'a'] }, { ...exact(), ownerScopeRef: '' }]) {
      expect(() => freezeLaunchRoutingContract(value)).toThrow();
    }
  });
});
