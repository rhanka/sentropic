import { describe, expect, it } from 'vitest';
import { InMemoryRouteHealth } from '../src/route-health.js';
import { DEFAULT_ROUTE_POLICY } from '../src/routing-policy.js';

const candidate = (modelId = 'gpt-5.6-sol') => ({
  account: {
    accountRef: 'internal-account',
    diagnosticAccountRef: 'acct_redacted',
    targetProviderId: 'openai',
    transportProviderId: 'codex',
    supportedModelIds: ['gpt-5.6-sol', 'gpt-5.6-terra'],
    enrollmentCompletedAt: '2026-08-01T00:00:00Z',
    readiness: 'ready' as const,
    revision: 'r1',
  },
  target: {
    requestedModel: modelId,
    providerId: 'openai',
    modelId,
    transportProviderId: 'codex',
    reason: 'exact' as const,
  },
});

describe('route health cache', () => {
  it('suppresses a retryable route only until its TTL expires', () => {
    let now = Date.parse('2026-08-08T00:00:00Z');
    const health = new InMemoryRouteHealth({ now: () => new Date(now) });
    health.record(candidate(), {
      reason: 'provider-5xx',
      retryable: true,
      healthScope: 'route',
    }, { ...DEFAULT_ROUTE_POLICY, negativeCacheTtlMs: 5_000 });

    expect(health.isSuppressed(candidate())).toBe(true);
    now += 5_000;
    expect(health.isSuppressed(candidate())).toBe(false);
  });

  it('uses bounded Retry-After instead of the generic TTL', () => {
    let now = Date.parse('2026-08-08T00:00:00Z');
    const health = new InMemoryRouteHealth({ now: () => new Date(now) });
    health.record(candidate(), {
      reason: 'rate-limited',
      retryable: true,
      retryAfterMs: 10_000,
      healthScope: 'route',
    }, { ...DEFAULT_ROUTE_POLICY, negativeCacheTtlMs: 300_000 });

    now += 10_000;
    expect(health.isSuppressed(candidate())).toBe(false);
  });

  it('suppresses equivalent models when the account health scope fails', () => {
    const health = new InMemoryRouteHealth({
      now: () => new Date('2026-08-08T00:00:00Z'),
    });
    health.record(candidate('gpt-5.6-sol'), {
      reason: 'network-unavailable',
      retryable: true,
      healthScope: 'account',
    }, DEFAULT_ROUTE_POLICY);

    expect(health.isSuppressed(candidate('gpt-5.6-terra'))).toBe(true);
  });

  it('does not poison health for invalid requests', () => {
    const health = new InMemoryRouteHealth({ now: () => new Date() });
    health.record(candidate(), {
      reason: 'invalid-request',
      retryable: false,
      healthScope: 'route',
    }, DEFAULT_ROUTE_POLICY);
    expect(health.isSuppressed(candidate())).toBe(false);
  });
});
