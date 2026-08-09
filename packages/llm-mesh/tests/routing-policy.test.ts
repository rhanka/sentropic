import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE_POLICY,
  InMemoryRoutePolicyProfiles,
  RoutePolicyError,
  validateRoutePolicy,
} from '../src/routing-policy.js';

describe('route policy', () => {
  it('defaults to last-enrolled with bounded preferred-route retest', () => {
    expect(DEFAULT_ROUTE_POLICY).toMatchObject({
      strategy: { kind: 'last-enrolled' },
      fallbackMode: 'retest-preferred',
      negativeCacheTtlMs: 300_000,
      maxAttempts: 3,
      stickyAccount: true,
      rotateEquivalentAccounts: false,
    });
    expect(() => validateRoutePolicy(DEFAULT_ROUTE_POLICY)).not.toThrow();
  });

  it('rejects unsafe cache, attempt and ordered-strategy bounds', () => {
    expect(() => validateRoutePolicy({
      ...DEFAULT_ROUTE_POLICY,
      negativeCacheTtlMs: 0,
      maxAttempts: 9,
      strategy: { kind: 'ordered', preferences: [] },
    })).toThrow(RoutePolicyError);
  });

  it('activates a named profile only at its expected revision', () => {
    const profiles = new InMemoryRoutePolicyProfiles([{
      name: 'coding',
      revision: 'r1',
      policy: {
        ...DEFAULT_ROUTE_POLICY,
        strategy: {
          kind: 'ordered',
          preferences: [
            { transportProviderId: 'codex' },
            { transportProviderId: 'claude-code' },
          ],
        },
      },
    }]);

    expect(profiles.activate('coding', 'r1').name).toBe('coding');
    expect(profiles.active()?.revision).toBe('r1');
    expect(() => profiles.activate('coding', 'stale')).toThrow(/revision changed/);
  });

  it('accepts per-model rules and new-affinity round-robin', () => {
    expect(() => validateRoutePolicy({
      ...DEFAULT_ROUTE_POLICY,
      strategy: { kind: 'round-robin', scope: 'new-affinity' },
      rules: [{
        match: { requestedModel: 'claude-opus-5' },
        strategy: {
          kind: 'ordered',
          preferences: [{ transportProviderId: 'claude-code' }],
        },
      }],
    })).not.toThrow();
  });
});
