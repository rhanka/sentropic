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
  it('records no suppression for a non-retryable local bound failure (R4-MIN-2)', () => {
    const health = new InMemoryRouteHealth({ now: () => new Date('2026-10-13T00:00:00Z') });
    health.record(candidate(), {
      reason: 'provider-5xx', retryable: false, healthScope: 'route',
    }, DEFAULT_ROUTE_POLICY);
    expect(health.isSuppressed(candidate())).toBe(false);
    expect(health.suppressedDegradable(candidate())).toBe(false);
  });

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

  it('keeps a committed suppression when a later uncommitted outcome lands on the same key', () => {
    let now = Date.parse('2026-08-08T00:00:00Z');
    const health = new InMemoryRouteHealth({ now: () => new Date(now) });
    const policy = { ...DEFAULT_ROUTE_POLICY, negativeCacheTtlMs: 300_000 };
    health.record(candidate(), {
      reason: 'provider-5xx', retryable: true, healthScope: 'route', committed: true,
    }, policy);
    now += 1_000;
    health.record(candidate(), {
      reason: 'provider-5xx', retryable: true, healthScope: 'route', committed: false,
    }, policy);

    expect(health.isSuppressed(candidate())).toBe(true);
    expect(health.suppressedDegradable(candidate())).toBe(false);

    // Past the committed entry's own TTL the route is suppressible again,
    // and a fresh uncommitted outcome degrades as before.
    now += 300_000;
    expect(health.isSuppressed(candidate())).toBe(false);
    health.record(candidate(), {
      reason: 'provider-5xx', retryable: true, healthScope: 'route', committed: false,
    }, policy);
    expect(health.isSuppressed(candidate())).toBe(true);
    expect(health.suppressedDegradable(candidate())).toBe(true);
  });

  it('still degrades a lone route suppressed only by uncommitted failures', () => {
    const health = new InMemoryRouteHealth({
      now: () => new Date('2026-08-08T00:00:00Z'),
    });
    health.record(candidate(), {
      reason: 'provider-5xx', retryable: true, healthScope: 'route', committed: false,
    }, DEFAULT_ROUTE_POLICY);

    expect(health.isSuppressed(candidate())).toBe(true);
    expect(health.suppressedDegradable(candidate())).toBe(true);
  });

  it('never degrades a route suppressed by a provider rate limit', () => {
    // A provider-issued 429 carries its own Retry-After; redispatching a lone
    // seat during that window is a retry storm, not an availability gap.
    let now = Date.parse('2026-08-08T00:00:00Z');
    const health = new InMemoryRouteHealth({ now: () => new Date(now) });
    health.record(candidate(), {
      reason: 'rate-limited', retryable: true, retryAfterMs: 10_000,
      healthScope: 'route', committed: false,
    }, DEFAULT_ROUTE_POLICY);

    expect(health.isSuppressed(candidate())).toBe(true);
    expect(health.suppressedDegradable(candidate())).toBe(false);

    // The route becomes dispatchable again only once Retry-After elapses.
    now += 10_000;
    expect(health.isSuppressed(candidate())).toBe(false);
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
