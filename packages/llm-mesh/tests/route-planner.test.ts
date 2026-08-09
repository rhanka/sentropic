import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_EQUIVALENCE_COUNCIL } from '../src/equivalence-council.js';
import { InMemoryRoutePlanner } from '../src/route-planner.js';
import { RoutePlanError } from '../src/route-planner-state.js';
import { FakeRouteDirectory, routingSubject } from './fixtures/route-planner.js';

const request = { requestedModel: 'gemini-3.5-flash' } as const;

describe('opaque route planner', () => {
  it('orders redacted candidates without exposing executable account references', async () => {
    const planner = new InMemoryRoutePlanner({ directory: new FakeRouteDirectory() });
    const plan = await planner.plan(routingSubject(), request);

    expect(plan.diagnostics.map((item) => item.diagnosticAccountRef))
      .toEqual(['acct_new', 'acct_old']);
    expect(plan.candidateRefs[0]).toMatch(/^candidate_/);
    expect(JSON.stringify(plan)).not.toContain('internal-new');
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

  it('falls back only to a same-account equivalent for a strict affinity', async () => {
    const directory = new FakeRouteDirectory();
    directory.accounts[1] = {
      ...directory.accounts[1]!,
      supportedModelIds: ['gemini-3.5-flash', 'gemini-3.1-flash-lite'],
    };
    const planner = new InMemoryRoutePlanner({
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
});
