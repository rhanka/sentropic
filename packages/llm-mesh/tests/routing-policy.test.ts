import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE_POLICY,
  InMemoryRoutePolicyProfiles,
  resolveRoutePolicy,
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

  it('applies only the first matching per-model fallback override', () => {
    const policy = resolveRoutePolicy({
      ...DEFAULT_ROUTE_POLICY,
      rules: [{
        match: { requestedModel: 'gpt-5.6-terra' },
        fallback: { fallbackMode: 'one-way', allowEquivalentModels: false },
      }, {
        match: { requestedModel: 'gpt-5.6-terra' },
        fallback: { fallbackMode: 'retest-preferred' },
      }],
    }, { requestedModel: 'gpt-5.6-terra' });

    expect(policy).toMatchObject({
      fallbackMode: 'one-way', allowEquivalentModels: false,
    });
  });

  it('matches intent rules only when the caller supplies that intent', () => {
    const base = {
      ...DEFAULT_ROUTE_POLICY,
      rules: [{
        match: { intent: 'coding' as const },
        fallback: { fallbackMode: 'one-way' as const },
      }],
    };

    expect(resolveRoutePolicy(base, {
      requestedModel: 'gpt-5.6-sol', intent: 'coding',
    }).fallbackMode).toBe('one-way');
    expect(resolveRoutePolicy(base, {
      requestedModel: 'gpt-5.6-sol', intent: 'general',
    }).fallbackMode).toBe('retest-preferred');
  });

  it('matches capability requirements reconstructed from JSON structurally', () => {
    const policy = {
      ...DEFAULT_ROUTE_POLICY,
      rules: [{
        match: {
          capabilities: JSON.parse('[{"capability":"input:image","required":true}]'),
        },
        fallback: { fallbackMode: 'one-way' as const },
      }],
    };
    const requiredCapabilities = JSON.parse(
      '[{"required":true,"capability":"input:image"}]',
    );

    expect(resolveRoutePolicy(policy, {
      requestedModel: 'gemini-3.5-flash', requiredCapabilities,
    }).fallbackMode).toBe('one-way');
  });
});
