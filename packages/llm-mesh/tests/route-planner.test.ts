import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_EQUIVALENCE_COUNCIL } from '../src/equivalence-council.js';
import { InMemoryRoutePlanner } from '../src/route-planner.js';
import { RoutePlanError } from '../src/route-planner-state.js';
import type { EligibleAccountDescriptor } from '../src/routing-contracts.js';
import type { PreparedNativeMessages } from '../src/native-messages.js';
import { DEFAULT_ROUTE_POLICY, InMemoryRoutePolicyProfiles } from '../src/routing-policy.js';
import { FakeRouteDirectory, routeAccounts, routingSubject } from './fixtures/route-planner.js';

const request = { requestedModel: 'gemini-3.5-flash' } as const;

// Explicit legacy mapping policy for fallback/health diagnostics; exact defaults are tested independently.
const selectedTableProfiles = () => {
  const profiles = new InMemoryRoutePolicyProfiles([{ name: 'selected-table', revision: 'v1',
    policy: { ...DEFAULT_ROUTE_POLICY, allowEquivalentModels: true } }]);
  profiles.activate('selected-table'); return profiles;
};
describe('opaque route planner', () => {
  it('orders redacted candidates without exposing executable account references', async () => {
    const planner = new InMemoryRoutePlanner({ directory: new FakeRouteDirectory() });
    const plan = await planner.plan(routingSubject(), request);

    expect(plan.diagnostics.map((item) => item.diagnosticAccountRef))
      .toEqual(['acct_new']);
    expect(plan.candidateRefs[0]).toMatch(/^candidate_/);
    expect(JSON.stringify(plan)).not.toContain('internal-new');
  });

  it('surfaces unknown models, unmet capabilities, and empty pools as distinct outcomes', async () => {
    const planner = new InMemoryRoutePlanner({ directory: new FakeRouteDirectory() });
    const emptyPoolPlanner = new InMemoryRoutePlanner({ directory: new FakeRouteDirectory([]) });

    await expect(planner.plan(routingSubject(), {
      requestedModel: 'unknown-contract-model',
    })).rejects.toMatchObject({ code: 'unknown-model' });
    await expect(planner.plan(routingSubject(), {
      requestedModel: 'gemini-3.5-flash', requiredCapabilities: ['input:audio'],
    })).rejects.toMatchObject({ code: 'capabilities-unmet' });
    await expect(emptyPoolPlanner.plan(routingSubject(), request))
      .rejects.toMatchObject({ code: 'no-route' });
  });

  it('rejects owner replay and candidate-index substitution', async () => {
    const directory = new FakeRouteDirectory();
    const planner = new InMemoryRoutePlanner({ directory });
    const plan = await planner.plan(routingSubject('user-a'), request);

    await expect(planner.prepareAttempt(
      routingSubject('user-b'), plan.planRef, plan.candidateRefs[0]!, 'req-1', 0,
    )).rejects.toMatchObject({ code: 'invalid-plan' });
    await expect(planner.prepareAttempt(
      routingSubject('user-a'), plan.planRef, plan.candidateRefs[1]!, 'req-1', 0,
    )).rejects.toMatchObject({ code: 'invalid-plan' });
    expect(directory.prepared).toHaveLength(0);
  });

  it('rejects replay of an exact prepared attempt tuple', async () => {
    const directory = new FakeRouteDirectory();
    const planner = new InMemoryRoutePlanner({ directory });
    const plan = await planner.plan(routingSubject(), request);
    await planner.prepareAttempt(
      routingSubject(), plan.planRef, plan.candidateRefs[0]!, 'req-replay', 0,
    );
    await expect(planner.prepareAttempt(
      routingSubject(), plan.planRef, plan.candidateRefs[0]!, 'req-replay', 0,
    )).rejects.toMatchObject({ code: 'invalid-plan' });
    expect(directory.prepared).toHaveLength(1);
  });

  it('revalidates account revision immediately before preparation', async () => {
    const directory = new FakeRouteDirectory();
    const planner = new InMemoryRoutePlanner({ directory });
    const plan = await planner.plan(routingSubject(), request);
    directory.accounts[1] = { ...directory.accounts[1]!, revision: 'r2' };

    await expect(planner.prepareAttempt(
      routingSubject(), plan.planRef, plan.candidateRefs[0]!, 'req-1', 0,
    )).rejects.toMatchObject({ code: 'stale-candidate' });
  });

  it('binds a new affinity to the successful account until audited reset', async () => {
    const directory = new FakeRouteDirectory();
    const planner = new InMemoryRoutePlanner({ directory });
    const first = await planner.plan(routingSubject(), {
      ...request,
      affinityKey: 'session-1',
      explicit: { diagnosticAccountRef: 'acct_old' },
    });
    const attempt = await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    );
    await attempt.complete();

    const sticky = await planner.plan(routingSubject(), {
      ...request,
      affinityKey: 'session-1',
    });
    expect(sticky.diagnostics[0]?.diagnosticAccountRef).toBe('acct_old');
    const affinity = planner.describeAffinity(routingSubject(), 'session-1');
    expect(() => planner.resetAffinity(
      routingSubject(), 'session-1', (affinity?.revision ?? 0) + 1,
    )).toThrow(/revision changed/);
    expect(planner.resetAffinity(
      routingSubject(), 'session-1', affinity?.revision,
    )).toBe(true);
  });

  it('requires explicit audited rebind to change an affinity account', async () => {
    const events: Array<{ operation: string; cacheContinuityRisk: boolean }> = [];
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory(),
      affinityAudit: (event) => events.push(event),
    });
    const first = await planner.plan(routingSubject(), {
      ...request, workspaceId: 'ws-1', affinityKey: 'session-2',
      explicit: { diagnosticAccountRef: 'acct_old' },
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();
    const alternatives = await planner.plan(routingSubject(), {
      ...request, workspaceId: 'ws-1', affinityKey: 'session-2',
      policyOverride: { stickyAccount: false },
    });
    const nextIndex = alternatives.diagnostics.findIndex(
      (candidate) => candidate.diagnosticAccountRef === 'acct_new',
    );

    expect(() => planner.promoteAffinity(
      routingSubject(), alternatives.planRef, alternatives.candidateRefs[nextIndex]!, 1,
    )).toThrow(/cannot change account/);
    const rebound = planner.rebindAffinity(
      routingSubject(), alternatives.planRef, alternatives.candidateRefs[nextIndex]!, 1,
    );
    expect(rebound.diagnosticAccountRef).toBe('acct_new');
    expect(planner.describeAffinity(routingSubject(), 'session-2', 'ws-1')?.revision).toBe(2);
    expect(events).toContainEqual(expect.objectContaining({
      operation: 'rebind', cacheContinuityRisk: true,
    }));
  });

  it('refuses an ungranted model switch without serving the stale sticky target', async () => {
    const directory = new FakeRouteDirectory([
      {
        accountRef: 'anthropic-internal', diagnosticAccountRef: 'anthropic-redacted',
        targetProviderId: 'anthropic', transportProviderId: 'claude-code',
        supportedModelIds: ['claude-opus-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
      {
        accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-02T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
    ]);
    const planner = new InMemoryRoutePlanner({ directory });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5', affinityKey: 'switch',
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();
    const before = planner.describeAffinity(routingSubject(), 'switch');
    expect(before?.target.providerId).toBe('anthropic');

    await expect(planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5', affinityKey: 'switch',
    })).rejects.toMatchObject({ code: 'no-route' });
    const quote = planner.quote({ requestedModel: 'claude-opus-5-5', ceiling: { inputTokens: 1, outputTokens: 10 }, now: new Date() });
    await expect(planner.plan(routingSubject(), { requestedModel: 'claude-opus-5-5', affinityKey: 'switch', quote }))
      .rejects.toMatchObject({ code: 'no-route' });
    expect(planner.describeAffinity(routingSubject(), 'switch')).toEqual(before);
    expect(directory.prepared).toHaveLength(1);
  });

  it('refuses a conflicting explicit account restriction without changing the pin', async () => {
    const directory = new FakeRouteDirectory([
      {
        accountRef: 'codex-a', diagnosticAccountRef: 'acct_a',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
      {
        accountRef: 'codex-b', diagnosticAccountRef: 'acct_b',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-02T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
    ]);
    const planner = new InMemoryRoutePlanner({ directory });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'gpt-6.1-sol', affinityKey: 'pinned',
      explicit: { diagnosticAccountRef: 'acct_a' },
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();
    const before = planner.describeAffinity(routingSubject(), 'pinned');

    await expect(planner.plan(routingSubject(), {
      requestedModel: 'gpt-6.1-sol', affinityKey: 'pinned', explicit: { diagnosticAccountRef: 'acct_b' },
    })).rejects.toMatchObject({ code: 'no-route' });
    expect(planner.describeAffinity(routingSubject(), 'pinned')).toEqual(before);
    expect(directory.prepared).toHaveLength(1);
  });

  it('refuses a sticky account that no longer advertises the requested model', async () => {
    const directory = new FakeRouteDirectory([{
      accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
      targetProviderId: 'openai', transportProviderId: 'codex',
      supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
      readiness: 'ready', revision: 'r1',
    }]);
    const planner = new InMemoryRoutePlanner({ directory });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'gpt-6.1-sol', affinityKey: 'astra-eligibility',
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();
    const before = planner.describeAffinity(routingSubject(), 'astra-eligibility');

    // The account stays ready but no longer advertises Sol.
    directory.accounts[0] = { ...directory.accounts[0]!, supportedModelIds: [] };

    await expect(planner.plan(routingSubject(), {
      requestedModel: 'gpt-6.1-sol', affinityKey: 'astra-eligibility',
    })).rejects.toMatchObject({ code: 'no-route' });
    expect(planner.describeAffinity(routingSubject(), 'astra-eligibility')).toEqual(before);
    expect(directory.prepared).toHaveLength(1);
  });

  it('refuses an ineligible sticky account even when the model was quoted', async () => {
    const directory = new FakeRouteDirectory([{
      accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
      targetProviderId: 'openai', transportProviderId: 'codex',
      supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
      readiness: 'ready', revision: 'r1',
    }]);
    const planner = new InMemoryRoutePlanner({ directory });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'gpt-6.1-sol', affinityKey: 'astra-eligibility-quoted',
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();
    const before = planner.describeAffinity(routingSubject(), 'astra-eligibility-quoted');
    const quote = planner.quote({
      requestedModel: 'gpt-6.1-sol',
      ceiling: { inputTokens: 1_000, outputTokens: 1_000 },
      now: new Date(),
    });

    // The account stays ready but no longer advertises Sol.
    directory.accounts[0] = { ...directory.accounts[0]!, supportedModelIds: [] };

    await expect(planner.plan(routingSubject(), {
      requestedModel: 'gpt-6.1-sol', affinityKey: 'astra-eligibility-quoted', quote,
    })).rejects.toMatchObject({ code: 'no-route' });
    expect(planner.describeAffinity(routingSubject(), 'astra-eligibility-quoted')).toEqual(before);
    expect(directory.prepared).toHaveLength(1);
  });

  it('refuses implicit policy migration while retaining the original affinity', async () => {
    const events: Array<{ operation: string; cacheContinuityRisk: boolean }> = [];
    const directory = new FakeRouteDirectory([
      {
        accountRef: 'anthropic-internal', diagnosticAccountRef: 'anthropic-redacted',
        targetProviderId: 'anthropic', transportProviderId: 'claude-code',
        supportedModelIds: ['claude-opus-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
      {
        accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-02T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
    ]);
    const planner = new InMemoryRoutePlanner({
      directory,
      affinityAudit: (event) => events.push(event),
    });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5', affinityKey: 'migrate',
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();

    const before = planner.describeAffinity(routingSubject(), 'migrate');
    await expect(planner.plan(routingSubject(), { requestedModel: 'claude-opus-5-5', affinityKey: 'migrate' }))
      .rejects.toMatchObject({ code: 'no-route' });
    expect(planner.describeAffinity(routingSubject(), 'migrate')).toEqual(before);
    expect(events).toEqual([]); expect(directory.prepared).toHaveLength(1);
  });

  it('leaves a stale affinity untouched when the standard alias plan fails', async () => {
    const directory = new FakeRouteDirectory([
      {
        accountRef: 'anthropic-internal', diagnosticAccountRef: 'anthropic-redacted',
        targetProviderId: 'anthropic', transportProviderId: 'claude-code',
        supportedModelIds: ['claude-opus-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
      {
        accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-02T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
    ]);
    const planner = new InMemoryRoutePlanner({ directory });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5', affinityKey: 'stale',
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();
    const before = planner.describeAffinity(routingSubject(), 'stale');

    await expect(planner.plan(routingSubject(), { requestedModel: 'claude-opus-5-5', affinityKey: 'stale' }))
      .rejects.toMatchObject({ code: 'no-route' });
    expect(planner.describeAffinity(routingSubject(), 'stale')).toEqual(before);
    expect(directory.prepared).toHaveLength(1);
  });

  it('leaves a stale affinity untouched on commit-then-failure or commit-then-cancellation', async () => {
    const makeIsolatedPlanner = () => {
      const events: Array<{ operation: string }> = [];
      const directory = new FakeRouteDirectory([
        {
          accountRef: 'anthropic-internal', diagnosticAccountRef: 'anthropic-redacted',
          targetProviderId: 'anthropic', transportProviderId: 'claude-code',
          supportedModelIds: ['claude-opus-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
          readiness: 'ready', revision: 'r1',
        },
        {
          accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
          targetProviderId: 'openai', transportProviderId: 'codex',
          supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-02T00:00:00Z',
          readiness: 'ready', revision: 'r1',
        },
      ]);
      const planner = new InMemoryRoutePlanner({
        directory,
        affinityAudit: (event) => events.push(event),
      });
      return { directory, events, planner };
    };

    for (const terminal of ['failure', 'cancelled']) {
      const { planner, directory, events } = makeIsolatedPlanner();
      const input = { requestedModel: 'claude-opus-5', affinityKey: terminal };
      const first = await planner.plan(routingSubject(), input);
      await (await planner.prepareAttempt(routingSubject(), first.planRef, first.candidateRefs[0]!, 'first', 0)).complete();
      const before = planner.describeAffinity(routingSubject(), terminal);
      await expect(planner.plan(routingSubject(), { ...input, requestedModel: 'claude-opus-5-5' })).rejects.toMatchObject({ code: 'no-route' });
      const active = await planner.plan(routingSubject(), input);
      const attempt = await planner.prepareAttempt(routingSubject(), active.planRef, active.candidateRefs[0]!, 'active', 0);
      await attempt.markCommitted();
      if (terminal === 'cancelled') await attempt.releaseCancelled();
      else await attempt.recordOutcome({ reason: 'provider-5xx', retryable: true, healthScope: 'route' });
      expect(planner.describeAffinity(routingSubject(), terminal)).toEqual(before);
      expect(directory.prepared).toHaveLength(2); expect(events).toEqual([]);
    }
  });

  it('keeps the original exact pin usable after refusing an implicit model upgrade', async () => {
    const events: Array<{ operation: string; cacheContinuityRisk: boolean }> = [];
    const directory = new FakeRouteDirectory([
      {
        accountRef: 'anthropic-internal', diagnosticAccountRef: 'anthropic-redacted',
        targetProviderId: 'anthropic', transportProviderId: 'claude-code',
        supportedModelIds: ['claude-opus-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
      {
        accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-02T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
    ]);
    const planner = new InMemoryRoutePlanner({
      directory,
      affinityAudit: (event) => events.push(event),
    });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5', affinityKey: 'stale-commit-success',
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();

    await expect(planner.plan(routingSubject(), { requestedModel: 'claude-opus-5-5', affinityKey: 'stale-commit-success' }))
      .rejects.toMatchObject({ code: 'no-route' });
    const same = await planner.plan(routingSubject(), { requestedModel: 'claude-opus-5', affinityKey: 'stale-commit-success' });
    const attempt = await planner.prepareAttempt(routingSubject(), same.planRef, same.candidateRefs[0]!, 'req-2', 0);
    await attempt.markCommitted(); await attempt.complete();
    expect(planner.describeAffinity(routingSubject(), 'stale-commit-success')?.target.modelId).toBe('claude-opus-5');
    expect(events).toEqual([]);
  });

  it('serves the newly requested exact model on a same-account switch', async () => {
    const events: Array<{ operation: string; cacheContinuityRisk: boolean }> = [];
    const directory = new FakeRouteDirectory([{
      accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
      targetProviderId: 'openai', transportProviderId: 'codex',
      supportedModelIds: ['gpt-6-sol', 'gpt-6.1-sol'],
      enrollmentCompletedAt: '2026-08-01T00:00:00Z',
      readiness: 'ready', revision: 'r1',
    }]);
    const planner = new InMemoryRoutePlanner({
      directory,
      affinityAudit: (event) => events.push(event),
    });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'gpt-6-sol', affinityKey: 'same-account',
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();

    const fresh = await planner.plan(routingSubject(), {
      requestedModel: 'gpt-6.1-sol', affinityKey: 'same-account', policyOverride: { fallbackMode: 'one-way' },
    });
    expect(fresh.diagnostics[0]).toMatchObject({
      actualModelId: 'gpt-6.1-sol', reason: 'sticky',
    });
    await (await planner.prepareAttempt(
      routingSubject(), fresh.planRef, fresh.candidateRefs[0]!, 'req-2', 0,
    )).complete();

    expect(planner.describeAffinity(routingSubject(), 'same-account')).toMatchObject({
      revision: 2, diagnosticAccountRef: 'codex-redacted',
    });
    expect(events).toContainEqual(expect.objectContaining({ operation: 'promote', cacheContinuityRisk: false }));
  });

  it.each(['route', 'account', 'transport', 'provider-model'] as const)(
    'falls back to another provider when Sol is suppressed at %s scope',
    async (healthScope) => {
      const directory = new FakeRouteDirectory([
        {
          accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
          targetProviderId: 'openai', transportProviderId: 'codex',
          supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-02T00:00:00Z',
          readiness: 'ready', revision: 'r1',
        },
        {
          accountRef: 'cloud-internal', diagnosticAccountRef: 'cloud-redacted',
          targetProviderId: 'gemini', transportProviderId: 'cloud-code',
          supportedModelIds: ['gemini-4-argon'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
          readiness: 'ready', revision: 'r1',
        },
      ]);
      const planner = new InMemoryRoutePlanner({ profiles: selectedTableProfiles(), directory });
      const first = await planner.plan(routingSubject(), {
        requestedModel: 'claude-opus-5-5',
      });
      expect(first.diagnostics[0]).toMatchObject({ actualModelId: 'gpt-6.1-sol' });
      await (await planner.prepareAttempt(
        routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
      )).recordOutcome({ reason: 'provider-5xx', retryable: true, healthScope });

      // The suppressed Sol route yields to the healthy Argon route.
      const fallback = await planner.plan(routingSubject(), {
        requestedModel: 'claude-opus-5-5',
      });
      expect(fallback.diagnostics[0]).toMatchObject({
        actualProviderId: 'gemini', actualModelId: 'gemini-4-argon', reason: 'alias',
      });
      await (await planner.prepareAttempt(
        routingSubject(), fallback.planRef, fallback.candidateRefs[0]!, 'req-2', 0,
      )).recordOutcome({ reason: 'provider-5xx', retryable: true, healthScope });

      // No-route only when every route is suppressed.
      await expect(planner.plan(routingSubject(), {
        requestedModel: 'claude-opus-5-5',
      })).rejects.toMatchObject({ code: 'no-route' });
    },
  );

  it('degrades a lone uncommitted-suppressed route within TTL and serves it again after', async () => {
    // Contract change (single-account degrade): an uncommitted failure produced
    // no upstream output, so retrying cannot duplicate a dispatch — the lone
    // route degrades instead of starving until TTL expiry.
    let now = Date.parse('2026-08-08T00:00:00Z');
    const directory = new FakeRouteDirectory([{
      accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
      targetProviderId: 'openai', transportProviderId: 'codex',
      supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
      readiness: 'ready', revision: 'r1',
    }]);
    const planner = new InMemoryRoutePlanner({ profiles: selectedTableProfiles(),
      directory,
      clock: { now: () => new Date(now) },
    });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5',
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).recordOutcome({ reason: 'provider-5xx', retryable: true, healthScope: 'route' });
    const degraded = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5',
    });
    expect(degraded.diagnostics[0]).toMatchObject({
      actualProviderId: 'openai', actualModelId: 'gpt-6.1-sol', reason: 'alias',
    });

    now += 300_000;
    const retried = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5',
    });
    expect(retried.diagnostics[0]).toMatchObject({
      actualProviderId: 'openai', actualModelId: 'gpt-6.1-sol', reason: 'alias',
    });
  });

  it('keeps a lone rate-limited route suppressed for its Retry-After instead of redispatching', async () => {
    // Quarantine must not be disabled by the lone-route degrade: a 429 with
    // Retry-After on the only account must hold the negative cache for the
    // provider-asked window, or every following request re-hits the seat.
    let now = Date.parse('2026-08-08T00:00:00Z');
    const directory = new FakeRouteDirectory([{
      accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
      targetProviderId: 'openai', transportProviderId: 'codex',
      supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
      readiness: 'ready', revision: 'r1',
    }]);
    const planner = new InMemoryRoutePlanner({ profiles: selectedTableProfiles(),
      directory,
      clock: { now: () => new Date(now) },
    });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5',
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).recordOutcome({
      reason: 'rate-limited', retryable: true, retryAfterMs: 10_000,
      healthScope: 'route',
    });

    // Inside the Retry-After window the lone route stays quarantined.
    await expect(planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5',
    })).rejects.toMatchObject({ code: 'no-route' });

    // Once the provider-asked window elapses the route serves again.
    now += 10_000;
    const retried = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5',
    });
    expect(retried.diagnostics[0]).toMatchObject({
      actualProviderId: 'openai', actualModelId: 'gpt-6.1-sol', reason: 'alias',
    });
  });

  it('keeps a compatible sticky Sol without rotating to a second account', async () => {
    const directory = new FakeRouteDirectory([
      {
        accountRef: 'codex-old', diagnosticAccountRef: 'acct_old',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
      {
        accountRef: 'codex-new', diagnosticAccountRef: 'acct_new',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-02T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
    ]);
    const planner = new InMemoryRoutePlanner({ profiles: selectedTableProfiles(), directory });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5', affinityKey: 'sticky-astra',
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();

    const second = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5', affinityKey: 'sticky-astra',
    });
    expect(second.diagnostics).toHaveLength(1);
    expect(second.diagnostics[0]).toMatchObject({
      diagnosticAccountRef: 'acct_new', actualProviderId: 'openai', reason: 'sticky',
    });
  });

  it('records a permitted account rotation without changing the selected model', async () => {
    const events: Array<{ operation: string; cacheContinuityRisk: boolean }> = [];
    const directory = new FakeRouteDirectory([
      {
        accountRef: 'codex-old', diagnosticAccountRef: 'acct_old',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
      {
        accountRef: 'codex-new', diagnosticAccountRef: 'acct_new',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-02T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
    ]);
    const planner = new InMemoryRoutePlanner({ profiles: selectedTableProfiles(),
      directory,
      affinityAudit: (event) => events.push(event),
    });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5', affinityKey: 'rotate-astra',
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();

    const fallback = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5', affinityKey: 'rotate-astra',
      policyOverride: { fallbackMode: 'one-way', rotateEquivalentAccounts: true },
    });
    expect(fallback.diagnostics.map((entry) =>
      [entry.diagnosticAccountRef, entry.actualProviderId, entry.reason]))
      .toEqual([['acct_new', 'openai', 'sticky'], ['acct_old', 'openai', 'alias']]);
    await (await planner.prepareAttempt(
      routingSubject(), fallback.planRef, fallback.candidateRefs[1]!, 'req-2', 1,
    )).complete();
    // Same-model account rotation is still a cache-continuity change.
    expect(planner.describeAffinity(routingSubject(), 'rotate-astra')).toMatchObject({
      diagnosticAccountRef: 'acct_old', revision: 2,
    });
    expect(events).toContainEqual(expect.objectContaining({ operation: 'rebind', cacheContinuityRisk: true }));
  });

  it('suppresses a failed preferred route until the injected clock reaches TTL', async () => {
    let now = Date.parse('2026-08-08T00:00:00Z');
    const directory = new FakeRouteDirectory();
    const planner = new InMemoryRoutePlanner({
      directory,
      clock: { now: () => new Date(now) },
    });
    const first = await planner.plan(routingSubject(), request);
    const attempt = await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    );
    await attempt.recordOutcome({
      reason: 'provider-5xx', retryable: true, healthScope: 'route',
    });

    const suppressed = await planner.plan(routingSubject(), request);
    expect(suppressed.diagnostics[0]?.diagnosticAccountRef).toBe('acct_old');
    now += 300_000;
    const retried = await planner.plan(routingSubject(), request);
    expect(retried.diagnostics[0]?.diagnosticAccountRef).toBe('acct_new');
  });

  it('removes suppressed routes before applying the maximum attempt bound', async () => {
    const directory = new FakeRouteDirectory();
    const planner = new InMemoryRoutePlanner({ directory });
    const boundedRequest = {
      ...request,
      policyOverride: { maxAttempts: 1 },
    };
    const first = await planner.plan(routingSubject(), boundedRequest);
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).recordOutcome({ reason: 'provider-5xx', retryable: true, healthScope: 'route' });

    const fallback = await planner.plan(routingSubject(), boundedRequest);

    expect(fallback.diagnostics).toHaveLength(1);
    expect(fallback.diagnostics[0]?.diagnosticAccountRef).toBe('acct_old');
  });

  it('serves the suppressed route when suppression would empty the candidate set', async () => {
    // Single eligible account inside its negative-cache TTL: degrade instead
    // of starving every route until TTL expiry.
    const directory = new FakeRouteDirectory([routeAccounts()[0]!]);
    const planner = new InMemoryRoutePlanner({ directory });
    const first = await planner.plan(routingSubject(), request);
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).recordOutcome({ reason: 'provider-5xx', retryable: true, healthScope: 'route' });

    const degraded = await planner.plan(routingSubject(), request);
    expect(degraded.diagnostics).toHaveLength(1);
    expect(degraded.diagnostics[0]?.diagnosticAccountRef).toBe('acct_old');
  });

  it('refuses a deleted account pin without silently replacing it', async () => {
    const directory = new FakeRouteDirectory();
    const planner = new InMemoryRoutePlanner({ directory });
    const first = await planner.plan(routingSubject(), {
      ...request,
      affinityKey: 'session-gone',
      explicit: { diagnosticAccountRef: 'acct_old' },
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();
    expect(planner.describeAffinity(
      routingSubject(), 'session-gone',
    )?.diagnosticAccountRef).toBe('acct_old');

    // The affinity account is deleted from the pool.
    const removed = directory.accounts.findIndex((entry) => entry.accountRef === 'internal-old');
    expect(removed).toBeGreaterThanOrEqual(0);
    directory.accounts.splice(removed, 1);

    await expect(planner.plan(routingSubject(), { ...request, affinityKey: 'session-gone' }))
      .rejects.toMatchObject({ code: 'no-route' });
    expect(planner.describeAffinity(routingSubject(), 'session-gone')?.diagnosticAccountRef).toBe('acct_old');
    expect(directory.prepared).toHaveLength(1);
  });

  it('refuses a deleted account pin under round-robin', async () => {
    const directory = new FakeRouteDirectory();
    const planner = new InMemoryRoutePlanner({ directory });
    const roundRobin = {
      ...request,
      policyOverride: {
        strategy: { kind: 'round-robin' as const, scope: 'new-affinity' as const },
      },
    };
    const first = await planner.plan(routingSubject(), {
      ...roundRobin,
      affinityKey: 'session-rr-gone',
      explicit: { diagnosticAccountRef: 'acct_old' },
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();

    const removed = directory.accounts.findIndex((entry) => entry.accountRef === 'internal-old');
    expect(removed).toBeGreaterThanOrEqual(0);
    directory.accounts.splice(removed, 1);

    await expect(planner.plan(routingSubject(), { ...roundRobin, affinityKey: 'session-rr-gone' }))
      .rejects.toMatchObject({ code: 'no-route' });
    expect(planner.describeAffinity(routingSubject(), 'session-rr-gone')?.diagnosticAccountRef).toBe('acct_old');
    expect(directory.prepared).toHaveLength(1);
  });

  it('shares new-affinity round-robin and sticky affinity across authenticated sessions', async () => {
    const directory = new FakeRouteDirectory();
    const planner = new InMemoryRoutePlanner({ directory });
    const roundRobin = {
      ...request,
      policyOverride: {
        strategy: { kind: 'round-robin' as const, scope: 'new-affinity' as const },
      },
    };
    const firstSession = routingSubject('session-principal-1', 'owner-a');
    const secondSession = routingSubject('session-principal-2', 'owner-a');
    const first = await planner.plan(firstSession, { ...roundRobin, affinityKey: 'affinity-1' });
    const second = await planner.plan(secondSession, { ...roundRobin, affinityKey: 'affinity-2' });

    expect(first.diagnostics[0]?.diagnosticAccountRef).toBe('acct_new');
    expect(second.diagnostics[0]?.diagnosticAccountRef).toBe('acct_old');

    await (await planner.prepareAttempt(
      firstSession, first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();
    const sticky = await planner.plan(secondSession, {
      ...roundRobin,
      affinityKey: 'affinity-1',
    });

    expect(sticky.diagnostics[0]?.diagnosticAccountRef).toBe('acct_new');
  });

  it('releases an uncommitted round-robin reservation and bounds route-key state', async () => {
    let now = Date.parse('2026-08-08T00:00:00Z');
    const directory = new FakeRouteDirectory();
    const planner = new InMemoryRoutePlanner({
      directory,
      clock: { now: () => new Date(now) },
      planTtlMs: 1_000,
      maximumPlanEntries: 2,
      maximumRoundRobinEntries: 2,
    });
    const rr = {
      ...request,
      policyOverride: {
        strategy: { kind: 'round-robin' as const, scope: 'new-affinity' as const },
      },
    };
    const abandoned = await planner.plan(routingSubject(), {
      ...rr, requestedModel: 'gemini-3.5-flash', affinityKey: 'abandoned',
    });
    expect(abandoned.diagnostics[0]?.diagnosticAccountRef).toBe('acct_new');
    now += 1_000;
    const replacement = await planner.plan(routingSubject(), {
      ...rr, requestedModel: 'gemini-3.5-flash', affinityKey: 'replacement',
    });
    expect(replacement.diagnostics[0]?.diagnosticAccountRef).toBe('acct_new');

    await planner.plan(routingSubject('session-b', 'owner-b'), {
      ...rr, affinityKey: 'key-2',
    });
    await planner.plan(routingSubject('session-c', 'owner-c'), {
      ...rr, affinityKey: 'key-3',
    });
  });

  it('falls back only to a same-account equivalent for a strict affinity', async () => {
    const directory = new FakeRouteDirectory();
    directory.accounts[1] = {
      ...directory.accounts[1]!,
      supportedModelIds: ['gemini-3.5-flash', 'gemini-3.1-flash-lite'],
    };
    const planner = new InMemoryRoutePlanner({ profiles: selectedTableProfiles(),
      directory,
      council: {
        ...DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
        groups: [{
          id: 'gemini-flash', intent: 'fast', expiresAt: '2027-01-01T00:00:00Z',
          evidence: [{
            suite: 'fixture', artifact: 'fixture.json', measuredAt: '2026-08-01T00:00:00Z',
            dimensions: { quality: 'equivalent' },
          }],
          members: [
            { providerId: 'gemini', modelId: 'gemini-3.5-flash', rank: 1, requiredCapabilities: [] },
            { providerId: 'gemini', modelId: 'gemini-3.1-flash-lite', rank: 2, requiredCapabilities: [] },
          ],
        }],
      },
    });
    const initial = await planner.plan(routingSubject(), {
      ...request, affinityKey: 'strict', explicit: { diagnosticAccountRef: 'acct_new' },
    });
    await (await planner.prepareAttempt(
      routingSubject(), initial.planRef, initial.candidateRefs[0]!, 'req-1', 0,
    )).complete();
    const preferred = await planner.plan(routingSubject(), {
      ...request, affinityKey: 'strict',
    });
    await (await planner.prepareAttempt(
      routingSubject(), preferred.planRef, preferred.candidateRefs[0]!, 'req-2', 0,
    )).recordOutcome({ reason: 'provider-5xx', retryable: true, healthScope: 'route' });

    const fallback = await planner.plan(routingSubject(), {
      ...request, affinityKey: 'strict',
    });
    expect(fallback.diagnostics[0]).toMatchObject({
      diagnosticAccountRef: 'acct_new', actualModelId: 'gemini-3.1-flash-lite',
    });
    expect(fallback.diagnostics.some((candidate) =>
      candidate.diagnosticAccountRef === 'acct_old')).toBe(false);
  });

  it('audits and persists an explicitly enabled one-way account rotation', async () => {
    const events: Array<{ operation: string; cacheContinuityRisk: boolean }> = [];
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory(),
      affinityAudit: (event) => events.push(event),
    });
    const first = await planner.plan(routingSubject(), {
      ...request, affinityKey: 'one-way',
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();
    const fallback = await planner.plan(routingSubject(), {
      ...request, affinityKey: 'one-way',
      policyOverride: { fallbackMode: 'one-way', rotateEquivalentAccounts: true },
    });
    await (await planner.prepareAttempt(
      routingSubject(), fallback.planRef, fallback.candidateRefs[1]!, 'req-2', 1,
    )).complete();

    expect(planner.describeAffinity(routingSubject(), 'one-way')).toMatchObject({
      diagnosticAccountRef: 'acct_old', promoted: false,
    });
    expect(events).toContainEqual(expect.objectContaining({
      operation: 'rebind', cacheContinuityRisk: true,
    }));
  });

  it('rejects attempt preparation after the plan expires', async () => {
    let now = Date.parse('2026-08-08T00:00:00Z');
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory(),
      clock: { now: () => new Date(now) },
      planTtlMs: 1_000,
    });
    const plan = await planner.plan(routingSubject(), request);
    now += 1_000;

    await expect(planner.prepareAttempt(
      routingSubject(), plan.planRef, plan.candidateRefs[0]!, 'req-1', 0,
    )).rejects.toBeInstanceOf(RoutePlanError);
  });

  it('bounds retained plans and affinities independently', async () => {
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory(), maximumPlanEntries: 1, maximumAffinityEntries: 1,
    });
    const first = await planner.plan(routingSubject(), { ...request, affinityKey: 'first' });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-1', 0,
    )).complete();
    const second = await planner.plan(routingSubject(), { ...request, affinityKey: 'second' });
    await (await planner.prepareAttempt(
      routingSubject(), second.planRef, second.candidateRefs[0]!, 'req-2', 0,
    )).complete();

    expect(planner.describeAffinity(routingSubject(), 'first')).toBeNull();
    expect(planner.describeAffinity(routingSubject(), 'second')).not.toBeNull();
    await expect(planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-3', 0,
    )).rejects.toMatchObject({ code: 'invalid-plan' });
  });

  it('never surfaces another transport diagnostic when no candidate matches', async () => {
    // Live-proven: an explicit gpt-5.6-terra (codex) request with empty
    // candidates surfaced `muse reauthenticate required` from listDiagnostics[0].
    // Diagnostics bind to the requested route transports, or stay generic.
    const museReauth = {
      code: 'reauth-required' as const, transportProviderId: 'muse',
      message: 'muse reauthenticate required',
    };
    const directory = new FakeRouteDirectory([]) as FakeRouteDirectory & {
      listDiagnostics: () => Promise<readonly typeof museReauth[]>;
    };
    directory.listDiagnostics = async () => [museReauth];
    const planner = new InMemoryRoutePlanner({ directory });

    const error = await planner.plan(routingSubject(), {
      requestedModel: 'gpt-5.6-terra',
    }).then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );
    expect((error as { code?: string }).code).toBe('no-route');
    expect(String((error as Error).message)).not.toContain('muse');
  });

  it('never surfaces another transport diagnostic under an explicit transport restriction', async () => {
    // The model-derived resolution ignores `explicit`: claude-fable-5
    // resolves to muse-route transports, so without the restriction below
    // the muse diagnostic would still match an explicit codex request.
    const museReauth = {
      code: 'reauth-required' as const, transportProviderId: 'muse',
      message: 'muse reauthenticate required',
    };
    const directory = new FakeRouteDirectory([]) as FakeRouteDirectory & {
      listDiagnostics: () => Promise<readonly typeof museReauth[]>;
    };
    directory.listDiagnostics = async () => [museReauth];
    const planner = new InMemoryRoutePlanner({ directory });

    const error = await planner.plan(routingSubject(), {
      requestedModel: 'claude-fable-5', explicit: { transportProviderId: 'codex' },
    }).then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );
    expect((error as { code?: string }).code).toBe('no-route');
    expect(String((error as Error).message)).toBe('No eligible route');
  });

  it('keeps a diagnostic bound to the requested transport', async () => {
    const museReauth = {
      code: 'reauth-required' as const, transportProviderId: 'muse',
      message: 'muse reauthenticate required',
    };
    const directory = new FakeRouteDirectory([]) as FakeRouteDirectory & {
      listDiagnostics: () => Promise<readonly typeof museReauth[]>;
    };
    directory.listDiagnostics = async () => [museReauth];
    const planner = new InMemoryRoutePlanner({ directory });

    const error = await planner.plan(routingSubject(), {
      requestedModel: 'muse-spark-1.3',
    }).then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );
    expect((error as { code?: string }).code).toBe('no-route');
    expect(String((error as Error).message)).toContain('muse reauthenticate required');
  });

  it('identifies unknown models and empty pools with distinct names and codes', async () => {
    const planner = new InMemoryRoutePlanner({ directory: new FakeRouteDirectory() });
    const directory = new FakeRouteDirectory([]);
    const empty = new InMemoryRoutePlanner({ directory });
    const rejectOf = (promise: Promise<unknown>) => promise.then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );

    const unknown = await rejectOf(planner.plan(routingSubject(), {
      requestedModel: 'unknown-contract-model',
    }));
    expect(unknown).toBeInstanceOf(RoutePlanError);
    expect(unknown).toMatchObject({ name: 'RoutePlanError', code: 'unknown-model' });

    const unavailable = await rejectOf(empty.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5',
    }));
    expect(unavailable).toBeInstanceOf(RoutePlanError);
    expect(unavailable).toMatchObject({ name: 'RoutePlanError', code: 'no-route' });
    expect(String((unavailable as Error).message)).toBe('No eligible route');
    // A failed plan prepares zero attempts.
    expect(directory.prepared).toHaveLength(0);
  });

  it('keeps the requested alias and Sol triple in success diagnostics', async () => {
    const planner = new InMemoryRoutePlanner({ profiles: selectedTableProfiles(),
      directory: new FakeRouteDirectory([{
        accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-6.1-sol'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      }]),
    });
    const plan = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5',
    });

    expect(plan.diagnostics).toEqual([{
      candidateRef: expect.any(String),
      diagnosticAccountRef: 'codex-redacted',
      requestedModel: 'claude-opus-5-5',
      actualProviderId: 'openai',
      actualModelId: 'gpt-6.1-sol',
      actualTransportProviderId: 'codex',
      reason: 'alias',
      cacheContinuityRisk: false,
    }]);
  });

  it('binds the alias no-route diagnostic to any requested transport', async () => {
    const codexReauth = {
      code: 'reauth-required' as const, transportProviderId: 'codex',
      message: 'codex reauthenticate required',
    };
    const codexDirectory = new FakeRouteDirectory([]) as FakeRouteDirectory & {
      listDiagnostics: () => Promise<readonly typeof codexReauth[]>;
    };
    codexDirectory.listDiagnostics = async () => [codexReauth];
    const codexError = await new InMemoryRoutePlanner({ profiles: selectedTableProfiles(), directory: codexDirectory })
      .plan(routingSubject(), { requestedModel: 'claude-opus-5-5' }).then(
        () => { throw new Error('expected rejection'); },
        (error: unknown) => error,
      );
    expect((codexError as { code?: string }).code).toBe('no-route');
    expect(String((codexError as Error).message)).toContain('codex reauthenticate required');

    // Muse is a requested transport for the alias, so its diagnostic surfaces.
    const museReauth = {
      code: 'reauth-required' as const, transportProviderId: 'muse',
      message: 'muse reauthenticate required',
    };
    const museDirectory = new FakeRouteDirectory([]) as FakeRouteDirectory & {
      listDiagnostics: () => Promise<readonly typeof museReauth[]>;
    };
    museDirectory.listDiagnostics = async () => [museReauth];
    const museError = await new InMemoryRoutePlanner({ profiles: selectedTableProfiles(), directory: museDirectory })
      .plan(routingSubject(), { requestedModel: 'claude-opus-5-5' }).then(
        () => { throw new Error('expected rejection'); },
        (error: unknown) => error,
      );
    expect((museError as { code?: string }).code).toBe('no-route');
    expect(String((museError as Error).message)).toContain('muse reauthenticate required');
  });

  it('should attach every matching transport diagnostic to the no-route error', async () => {
    const codexReauth = {
      code: 'reauth-required' as const, transportProviderId: 'codex',
      message: 'codex credential expired at 2026-01-01T00:00:00.000Z; reauthenticate the codex account',
    };
    const museReauth = {
      code: 'reauth-required' as const, transportProviderId: 'muse',
      message: 'muse authentication must be renewed; reauthenticate the muse account',
    };
    const directory = new FakeRouteDirectory([]) as FakeRouteDirectory & {
      listDiagnostics: () => Promise<readonly (typeof codexReauth | typeof museReauth)[]>;
    };
    directory.listDiagnostics = async () => [codexReauth, museReauth];
    const planner = new InMemoryRoutePlanner({ profiles: selectedTableProfiles(), directory });

    const error = await planner.plan(routingSubject(), {
      requestedModel: 'claude-opus-5-5',
    }).then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );
    expect((error as { code?: string }).code).toBe('no-route');
    const record = error as {
      diagnostic?: unknown; diagnostics?: readonly unknown[];
    };
    expect(record.diagnostics).toHaveLength(2);
    expect(record.diagnostic).toBe(record.diagnostics?.[0]);
    expect(String((error as Error).message)).toContain('codex credential expired');
  });

  it('should describe per-transport availability without planning', async () => {
    const codexReauth = {
      code: 'reauth-required' as const, transportProviderId: 'codex',
      message: 'codex reauthenticate required',
    };
    const museReauth = {
      code: 'reauth-required' as const, transportProviderId: 'muse',
      message: 'muse reauthenticate required',
    };
    const directory = new FakeRouteDirectory([]) as FakeRouteDirectory & {
      listDiagnostics: () => Promise<readonly (typeof codexReauth | typeof museReauth)[]>;
    };
    directory.listDiagnostics = async () => [codexReauth, museReauth];
    const planner = new InMemoryRoutePlanner({ profiles: selectedTableProfiles(), directory });

    const entries = await planner.describeAvailability(routingSubject(), {
      requestedModel: 'claude-opus-5-5',
    });
    expect(entries).toHaveLength(2);

    const restricted = await planner.describeAvailability(routingSubject(), {
      requestedModel: 'claude-opus-5-5', explicit: { transportProviderId: 'codex' },
    });
    expect(restricted).toEqual([codexReauth]);

    const unknown = await planner.describeAvailability(routingSubject(), {
      requestedModel: 'unknown-contract-model',
    });
    expect(unknown).toEqual([]);
  });

  it('lists ready inventory including an advertised alias', async () => {
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory([
        {
          accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
          targetProviderId: 'openai', transportProviderId: 'codex',
          supportedModelIds: ['gpt-6.1-sol', 'claude-opus-5-5'],
          enrollmentCompletedAt: '2026-08-01T00:00:00Z',
          readiness: 'ready', revision: 'r1',
        },
        {
          accountRef: 'cloud-internal', diagnosticAccountRef: 'cloud-redacted',
          targetProviderId: 'gemini', transportProviderId: 'cloud-code',
          supportedModelIds: ['gemini-3.8-flash'],
          enrollmentCompletedAt: '2026-08-02T00:00:00Z',
          readiness: 'ready', revision: 'r1',
        },
      ]),
    });

    expect(await planner.listModels(routingSubject())).toEqual([
      { modelId: 'claude-opus-5-5', providerId: 'openai' },
      { modelId: 'gemini-3.8-flash', providerId: 'gemini' },
      { modelId: 'gpt-6.1-sol', providerId: 'openai' },
    ]);
    const empty = new InMemoryRoutePlanner({ directory: new FakeRouteDirectory([]) });
    expect(await empty.listModels(routingSubject())).toEqual([]);
  });

  it('rejects a plan after its named policy revision changes', async () => {
    const profiles = new InMemoryRoutePolicyProfiles([{
      name: 'coding', revision: 'r1', policy: DEFAULT_ROUTE_POLICY,
    }]);
    profiles.activate('coding');
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory(), profiles,
    });
    const plan = await planner.plan(routingSubject(), request);
    profiles.set({ name: 'coding', revision: 'r2', policy: DEFAULT_ROUTE_POLICY });

    await expect(planner.prepareAttempt(
      routingSubject(), plan.planRef, plan.candidateRefs[0]!, 'req-1', 0,
    )).rejects.toMatchObject({ code: 'invalid-plan' });
  });

  it('rejects unqualified requested models at P0 with native-unavailable', async () => {
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory([
        {
          accountRef: 'internal-anthropic-native', diagnosticAccountRef: 'acct_native',
          targetProviderId: 'anthropic', transportProviderId: 'claude-code',
          supportedModelIds: ['claude-sonnet-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
          readiness: 'ready', revision: 'r1',
          nativeMessages: { contractVersion: 1, protocol: 'anthropic-messages' },
        },
      ]),
      nativeMessagesModelIds: ['claude-sonnet-5'],
    });
    await expect(planner.plan(routingSubject(), { requestedModel: 'claude-opus-5-5', nativeMessages: true }))
      .rejects.toMatchObject({ code: 'native-unavailable' });
    await expect(planner.plan(routingSubject(), { requestedModel: 'gemini-3.5-flash', nativeMessages: true }))
      .rejects.toMatchObject({ code: 'native-unavailable' });
    await expect(planner.plan(routingSubject(), { requestedModel: 'unknown-contract-model', nativeMessages: true }))
      .rejects.toMatchObject({ code: 'unknown-model' });
  });

  it('distinguishes empty from filtered-empty pools under nativeMessages requirement', async () => {
    const emptyPlanner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory([]),
      nativeMessagesModelIds: ['claude-sonnet-5'],
    });
    await expect(emptyPlanner.plan(routingSubject(), { requestedModel: 'claude-sonnet-5', nativeMessages: true }))
      .rejects.toMatchObject({ code: 'no-route' });

    const canonicalOnlyPlanner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory([{
        accountRef: 'internal-anthropic-canonical', diagnosticAccountRef: 'acct_canonical',
        targetProviderId: 'anthropic', transportProviderId: 'claude-code',
        supportedModelIds: ['claude-sonnet-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      }]),
      nativeMessagesModelIds: ['claude-sonnet-5'],
    });
    await expect(canonicalOnlyPlanner.plan(routingSubject(), { requestedModel: 'claude-sonnet-5', nativeMessages: true }))
      .rejects.toMatchObject({ code: 'native-unavailable' });
  });

  it('ignores ineligible sticky affinity without mutating stored affinity', async () => {
    const accounts: EligibleAccountDescriptor[] = [
      {
        accountRef: 'internal-canonical', diagnosticAccountRef: 'acct_canonical',
        targetProviderId: 'anthropic', transportProviderId: 'claude-code',
        supportedModelIds: ['claude-sonnet-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      },
      {
        accountRef: 'internal-native', diagnosticAccountRef: 'acct_native',
        targetProviderId: 'anthropic', transportProviderId: 'claude-code',
        supportedModelIds: ['claude-sonnet-5'], enrollmentCompletedAt: '2026-08-02T00:00:00Z',
        readiness: 'ready', revision: 'r1',
        nativeMessages: { contractVersion: 1, protocol: 'anthropic-messages' },
      },
    ];
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory(accounts),
      nativeMessagesModelIds: ['claude-sonnet-5'],
    });
    const canonicalPlan = await planner.plan(routingSubject(), {
      requestedModel: 'claude-sonnet-5', affinityKey: 'k1',
      explicit: { diagnosticAccountRef: 'acct_canonical' },
    });
    const attempt = await planner.prepareAttempt(
      routingSubject(), canonicalPlan.planRef, canonicalPlan.candidateRefs[0]!, 'req-1', 0,
    );
    await attempt.complete();

    const storedAffinity = planner.describeAffinity(routingSubject(), 'k1');
    expect(storedAffinity).not.toBeNull();
    expect(storedAffinity?.diagnosticAccountRef).toBe('acct_canonical');

    const nativePlan = await planner.plan(routingSubject(), {
      requestedModel: 'claude-sonnet-5', affinityKey: 'k1', nativeMessages: true,
    });
    expect(nativePlan.diagnostics[0]?.diagnosticAccountRef).toBe('acct_native');

    const unchangedAffinity = planner.describeAffinity(routingSubject(), 'k1');
    expect(unchangedAffinity).toEqual(storedAffinity);
    expect(unchangedAffinity?.diagnosticAccountRef).toBe('acct_canonical');
    expect(unchangedAffinity?.target).toEqual(storedAffinity?.target);
    expect(unchangedAffinity?.revision).toBe(storedAffinity?.revision);

    const nextCanonical = await planner.plan(routingSubject(), {
      requestedModel: 'claude-sonnet-5', affinityKey: 'k1',
    });
    expect(nextCanonical.diagnostics[0]?.diagnosticAccountRef).toBe('acct_canonical');
  });

  it('applies native candidate filtering before maxAttempts truncation in mixed pools', async () => {
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory([
        {
          accountRef: 'internal-canonical', diagnosticAccountRef: 'acct_canonical',
          targetProviderId: 'anthropic', transportProviderId: 'claude-code',
          supportedModelIds: ['claude-sonnet-5'], enrollmentCompletedAt: '2026-08-02T00:00:00Z',
          readiness: 'ready', revision: 'r1',
        },
        {
          accountRef: 'internal-native', diagnosticAccountRef: 'acct_native',
          targetProviderId: 'anthropic', transportProviderId: 'claude-code',
          supportedModelIds: ['claude-sonnet-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
          readiness: 'ready', revision: 'r1',
          nativeMessages: { contractVersion: 1, protocol: 'anthropic-messages' },
        },
      ]),
      nativeMessagesModelIds: ['claude-sonnet-5'],
    });
    const canonicalPlan = await planner.plan(routingSubject(), {
      requestedModel: 'claude-sonnet-5', policyOverride: { maxAttempts: 1 },
    });
    expect(canonicalPlan.diagnostics).toHaveLength(1);
    expect(canonicalPlan.diagnostics[0]?.diagnosticAccountRef).toBe('acct_canonical');

    const nativePlan = await planner.plan(routingSubject(), {
      requestedModel: 'claude-sonnet-5', nativeMessages: true, policyOverride: { maxAttempts: 1 },
    });
    expect(nativePlan.diagnostics).toHaveLength(1);
    expect(nativePlan.diagnostics[0]?.diagnosticAccountRef).toBe('acct_native');
  });

  it('returns native-unavailable rather than no-route for suppressed canonical-only pools', async () => {
    // Adapted from R: R suppressed with a lone provider-5xx, but W pins the
    // single-account degrade (uncommitted failures still serve the lone route),
    // so suppression here uses rate-limit quarantine, which holds even lone.
    const now = Date.parse('2026-08-08T00:00:00Z');
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory([{
        accountRef: 'internal-canonical', diagnosticAccountRef: 'acct_canonical',
        targetProviderId: 'anthropic', transportProviderId: 'claude-code',
        supportedModelIds: ['claude-sonnet-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      }]),
      nativeMessagesModelIds: ['claude-sonnet-5'],
      clock: { now: () => new Date(now) },
    });
    const canonicalPlan = await planner.plan(routingSubject(), { requestedModel: 'claude-sonnet-5' });
    await (await planner.prepareAttempt(
      routingSubject(), canonicalPlan.planRef, canonicalPlan.candidateRefs[0]!, 'req-1', 0,
    )).recordOutcome({
      reason: 'rate-limited', retryable: true, retryAfterMs: 60_000, healthScope: 'account',
    });

    await expect(planner.plan(routingSubject(), { requestedModel: 'claude-sonnet-5' }))
      .rejects.toMatchObject({ code: 'no-route' });
    await expect(planner.plan(routingSubject(), { requestedModel: 'claude-sonnet-5', nativeMessages: true }))
      .rejects.toMatchObject({ code: 'native-unavailable' });
  });

  it('preserves no-route when eligible native capacity is suppressed by health', async () => {
    // Same W adaptation as above: quarantine, not a lone 5xx, suppresses.
    const now = Date.parse('2026-08-08T00:00:00Z');
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory([{
        accountRef: 'internal-native', diagnosticAccountRef: 'acct_native',
        targetProviderId: 'anthropic', transportProviderId: 'claude-code',
        supportedModelIds: ['claude-sonnet-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
        nativeMessages: { contractVersion: 1, protocol: 'anthropic-messages' },
      }]),
      nativeMessagesModelIds: ['claude-sonnet-5'],
      clock: { now: () => new Date(now) },
    });
    const firstPlan = await planner.plan(routingSubject(), {
      requestedModel: 'claude-sonnet-5', nativeMessages: true,
    });
    await (await planner.prepareAttempt(
      routingSubject(), firstPlan.planRef, firstPlan.candidateRefs[0]!, 'req-2', 0,
    )).recordOutcome({
      reason: 'rate-limited', retryable: true, retryAfterMs: 60_000, healthScope: 'account',
    });

    await expect(planner.plan(routingSubject(), { requestedModel: 'claude-sonnet-5', nativeMessages: true }))
      .rejects.toMatchObject({ code: 'no-route' });
  });

  it('forwards native capability only with fresh descriptor, eligible target, and matching model', async () => {
    const validCapability: PreparedNativeMessages = {
      contractVersion: 1, protocol: 'anthropic-messages', modelId: 'claude-sonnet-5',
      apiVersions: ['2023-06-01'], requiredBetas: [],
      execute: async () => ({ kind: 'json', status: 200, body: {}, headers: {} }),
    };

    class NativeDir extends FakeRouteDirectory {
      constructor(accounts: EligibleAccountDescriptor[], private capability?: PreparedNativeMessages) {
        super(accounts);
      }
      override async prepareAttempt(input: any) {
        const base = await super.prepareAttempt(input);
        return { ...base, nativeMessages: this.capability };
      }
    }

    const accounts: EligibleAccountDescriptor[] = [
      {
        accountRef: 'internal-native', diagnosticAccountRef: 'acct_native',
        targetProviderId: 'anthropic', transportProviderId: 'claude-code',
        supportedModelIds: ['claude-sonnet-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready', revision: 'r1',
        nativeMessages: { contractVersion: 1, protocol: 'anthropic-messages' },
      },
    ];

    const dir = new NativeDir(accounts, validCapability);
    const planner = new InMemoryRoutePlanner({ directory: dir, nativeMessagesModelIds: ['claude-sonnet-5'] });
    const plan = await planner.plan(routingSubject(), { requestedModel: 'claude-sonnet-5' });
    const attempt = await planner.prepareAttempt(routingSubject(), plan.planRef, plan.candidateRefs[0]!, 'r1', 0);
    expect(attempt.nativeMessages).toBe(validCapability);

    await attempt.complete();
    await attempt.complete();
    expect(dir.prepared[0]?.completed).toBe(1);

    const mismatchDir = new NativeDir(accounts, { ...validCapability, modelId: 'claude-opus-5' });
    const mismatchPlanner = new InMemoryRoutePlanner({ directory: mismatchDir, nativeMessagesModelIds: ['claude-sonnet-5'] });
    const mismatchPlan = await mismatchPlanner.plan(routingSubject(), { requestedModel: 'claude-sonnet-5' });
    const mismatchAttempt = await mismatchPlanner.prepareAttempt(routingSubject(), mismatchPlan.planRef, mismatchPlan.candidateRefs[0]!, 'r2', 0);
    expect(mismatchAttempt.nativeMessages).toBeUndefined();

    class StaleDir extends NativeDir {
      private polled = false;
      override async listEligible(sub: any) {
        if (!this.polled) { this.polled = true; return accounts; }
        return [{ ...accounts[0]!, nativeMessages: undefined }];
      }
    }
    const staleDir = new StaleDir(accounts, validCapability);
    const stalePlanner = new InMemoryRoutePlanner({ directory: staleDir, nativeMessagesModelIds: ['claude-sonnet-5'] });
    const stalePlan = await stalePlanner.plan(routingSubject(), { requestedModel: 'claude-sonnet-5' });
    const staleAttempt = await stalePlanner.prepareAttempt(routingSubject(), stalePlan.planRef, stalePlan.candidateRefs[0]!, 'r3', 0);
    expect(staleAttempt.nativeMessages).toBeUndefined();
  });
});
