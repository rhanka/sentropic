import { describe, expect, it } from 'vitest';
import { modelProfiles } from '../src/catalog.js';
import { DEFAULT_MODEL_EQUIVALENCE_COUNCIL } from '../src/equivalence-council.js';
import * as mesh from '../src/index.js';
import { InMemoryRoutePlanner } from '../src/route-planner.js';
import { RoutePlanError } from '../src/route-planner-state.js';
import { MAX_ROUTE_QUOTE_CANDIDATES, quoteRoute, RouteQuoteError } from '../src/route-quote.js';
import type {
  AccountDirectoryPort, EligibleAccountDescriptor, RoutePlan, RouteQuote, RouteQuoteInput,
} from '../src/routing-contracts.js';
import { InMemoryRoutePolicyProfiles, RoutePolicyError, DEFAULT_ROUTE_POLICY } from '../src/routing-policy.js';
import { CANONICAL_TARGET_ROUTE_MAPPINGS } from '../src/routing-targets.js';
import { FakeRouteDirectory, routingSubject } from './fixtures/route-planner.js';

const NOW = new Date('2026-09-25T12:00:00Z');
const ceiling = { inputTokens: 1_000, outputTokens: 100_000 } as const;
const quoteInput = (requestedModel: string, extra: Partial<RouteQuoteInput> = {}): RouteQuoteInput => ({
  requestedModel, ceiling, now: NOW, ...extra,
});
const fixedClock = { now: () => new Date(NOW.getTime()) };
const SKEWED = new Date('2026-09-27T00:00:00Z');
const skewedClock = { now: () => new Date(SKEWED.getTime()) };
const evidence = [{
  suite: 'fixture', artifact: 'fixture.json', measuredAt: '2026-08-01T00:00:00Z',
  dimensions: { quality: 'equivalent' as const },
}];
/** Two long-lived groups (one with transport preferences) and one expiring between NOW and SKEWED. */
const SUPERSET_COUNCIL = {
  ...DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
  groups: [
    {
      id: 'gemini-flash', intent: 'fast' as const, expiresAt: '2027-01-01T00:00:00Z', evidence,
      members: [
        { providerId: 'gemini', modelId: 'gemini-3.5-flash', rank: 1, requiredCapabilities: [] },
        {
          providerId: 'gemini', modelId: 'gemini-3.1-flash-lite', rank: 2, requiredCapabilities: [],
          transportPreferences: ['antigravity', 'cloud-code'],
        },
      ],
    },
    {
      id: 'openai-nano', intent: 'fast' as const, expiresAt: '2027-01-01T00:00:00Z', evidence,
      members: [
        { providerId: 'openai', modelId: 'gpt-5.4-nano', rank: 1, requiredCapabilities: [] },
        { providerId: 'openai', modelId: 'gpt-4.1-nano', rank: 2, requiredCapabilities: [] },
      ],
    },
    {
      id: 'mistral-expiring', intent: 'general' as const, expiresAt: '2026-09-26T00:00:00Z', evidence,
      members: [
        { providerId: 'mistral', modelId: 'mistral-small-2603', rank: 1, requiredCapabilities: [] },
        {
          providerId: 'mistral', modelId: 'magistral-medium-2509', rank: 2, requiredCapabilities: [],
          transportPreferences: ['muse'],
        },
      ],
    },
  ],
};


class SpyDirectory implements AccountDirectoryPort {
  readonly calls: string[] = [];
  constructor(private readonly inner: AccountDirectoryPort) {}
  async listEligible(...args: Parameters<AccountDirectoryPort['listEligible']>) {
    this.calls.push('listEligible');
    return this.inner.listEligible(...args);
  }
  async listDiagnostics(...args: Parameters<NonNullable<AccountDirectoryPort['listDiagnostics']>>) {
    this.calls.push('listDiagnostics');
    return this.inner.listDiagnostics?.(...args) ?? [];
  }
  async prepareAttempt(...args: Parameters<AccountDirectoryPort['prepareAttempt']>) {
    this.calls.push('prepareAttempt');
    return this.inner.prepareAttempt(...args);
  }
}

const transports = ['codex', 'cloud-code', 'claude-code', 'antigravity', 'muse'];
const allModelIds = [...new Set([
  ...modelProfiles.map((profile) => profile.modelId as string),
  ...Object.values(CANONICAL_TARGET_ROUTE_MAPPINGS).flat().map((target) => target.model),
  ...DEFAULT_MODEL_EQUIVALENCE_COUNCIL.groups.flatMap((group) =>
    group.members.map((member) => member.modelId)),
])];
const allProviders = [...new Set([
  ...modelProfiles.map((profile) => profile.providerId as string),
  ...Object.values(CANONICAL_TARGET_ROUTE_MAPPINGS).flat().map((target) => target.providerId),
])];
/** Over-broad directory: every provider on every transport supports every known model. */
const broadAccounts = (): EligibleAccountDescriptor[] => allProviders.flatMap((providerId) =>
  transports.map((transportProviderId, index) => ({
    accountRef: `internal-${providerId}-${transportProviderId}`,
    diagnosticAccountRef: `acct_${providerId}_${transportProviderId}`,
    targetProviderId: providerId,
    transportProviderId,
    supportedModelIds: allModelIds,
    enrollmentCompletedAt: `2026-08-0${index + 1}T00:00:00Z`,
    readiness: 'ready' as const,
    revision: 'r1',
  })));
const requestedModels = [...new Set([
  ...Object.keys(CANONICAL_TARGET_ROUTE_MAPPINGS),
  ...modelProfiles.map((profile) => profile.modelId as string),
])].sort();

const quoted = (quote: RouteQuote, target: {
  actualProviderId: string; actualModelId: string; actualTransportProviderId: string;
}): boolean => quote.candidates.some((candidate) =>
  candidate.providerId === target.actualProviderId
  && candidate.modelId === target.actualModelId
  && (candidate.transportProviderId === undefined
    || candidate.transportProviderId === target.actualTransportProviderId));

const expectQuoteError = (run: () => unknown, code: RouteQuoteError['code']): void => {
  let caught: unknown;
  try { run(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(RouteQuoteError);
  expect(caught).toMatchObject({ code });
};

describe('pure route quote', () => {
  it('is exported from the package entry', () => {
    expect(mesh.quoteRoute).toBe(quoteRoute);
    expect(mesh.RouteQuoteError).toBe(RouteQuoteError);
    expect(mesh.MAX_ROUTE_QUOTE_CANDIDATES).toBe(16);
  });

  it('makes zero directory calls and reads no clock or id factory', () => {
    const directory = new SpyDirectory(new FakeRouteDirectory());
    let clockReads = 0; let ids = 0;
    const planner = new InMemoryRoutePlanner({
      directory,
      clock: { now: () => { clockReads += 1; return new Date(NOW.getTime()); } },
      idFactory: { next: (prefix) => { ids += 1; return `${prefix}_${ids}`; } },
    });
    const quote = planner.quote(quoteInput('claude-opus-5-high'));
    expect(quote.candidates.length).toBeGreaterThan(0);
    expect(directory.calls).toEqual([]);
    expect(clockReads).toBe(0);
    expect(ids).toBe(0);
  });

  it('is deterministic, frozen and leaves its input untouched', () => {
    const input = quoteInput('claude-sonnet-5', {
      requiredCapabilities: ['tools'], ceiling: { ...ceiling, reasoningTokens: 50, toolCalls: 4 },
    });
    const snapshot = JSON.stringify(input);
    const first = quoteRoute(input);
    const second = quoteRoute(structuredClone(input));
    expect(second).toEqual(first);
    expect(first.quoteRef).toMatch(/^quote_[0-9a-f]{16}$/);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.candidates[0]!.allowance)).toBe(true);
    expect(first.candidates[0]!.allowance).toEqual({
      inputTokens: 1_000, outputTokens: 100_000, reasoningTokens: 50, toolCalls: 4,
    });
    expect(quoteRoute({ ...input, ceiling: { ...input.ceiling, outputTokens: 7 } }).quoteRef)
      .not.toBe(first.quoteRef);
  });

  it('uses the injected clock value for council freshness', () => {
    const group = {
      id: 'gemini-flash', intent: 'fast' as const, expiresAt: '2026-10-01T00:00:00Z',
      evidence: [{
        suite: 'fixture', artifact: 'fixture.json', measuredAt: '2026-08-01T00:00:00Z',
        dimensions: { quality: 'equivalent' as const },
      }],
      members: [
        { providerId: 'gemini', modelId: 'gemini-3.5-flash', rank: 1, requiredCapabilities: [] },
        { providerId: 'gemini', modelId: 'gemini-3.1-flash-lite', rank: 2, requiredCapabilities: [] },
      ],
    };
    const council = { ...DEFAULT_MODEL_EQUIVALENCE_COUNCIL, groups: [group] };
    const fresh = quoteRoute(quoteInput('gemini-3.5-flash'), { council });
    const expired = quoteRoute(
      quoteInput('gemini-3.5-flash', { now: new Date('2026-10-02T00:00:00Z') }), { council },
    );
    expect(fresh.candidates.map((candidate) => [candidate.modelId, candidate.reason])).toEqual([
      ['gemini-3.5-flash', 'exact'], ['gemini-3.1-flash-lite', 'equivalent'],
    ]);
    expect(expired.candidates.map((candidate) => candidate.modelId)).toEqual(['gemini-3.5-flash']);
  });

  it('caps candidates at 16 and raises too-many-candidates beyond', () => {
    const override = (count: number) => Array.from({ length: count }, (_, index) => ({
      providerId: 'gemini', transportProviderId: 'cloud-code', model: `fixture-model-${index}`,
    }));
    const policyOverride = { allowEquivalentModels: false };
    expect(MAX_ROUTE_QUOTE_CANDIDATES).toBe(16);
    expect(quoteRoute(quoteInput('gemini-3.5-flash', {
      targetCandidatesOverride: override(16), policyOverride,
    })).candidates).toHaveLength(16);
    expectQuoteError(() => quoteRoute(quoteInput('gemini-3.5-flash', {
      targetCandidatesOverride: override(17), policyOverride,
    })), 'too-many-candidates');
  });

  it('resolves attempts from the validated policy within 1..8', () => {
    const profiles = new InMemoryRoutePolicyProfiles([
      { name: 'wide', revision: 'rev-8', policy: { ...DEFAULT_ROUTE_POLICY, maxAttempts: 8 } },
      { name: 'single', revision: 'rev-1', policy: { ...DEFAULT_ROUTE_POLICY, maxAttempts: 1 } },
    ]);
    expect(quoteRoute(quoteInput('gemini-3.5-flash'))).toMatchObject({
      maxAttempts: 3, policyRevision: 'default',
      councilRevision: DEFAULT_MODEL_EQUIVALENCE_COUNCIL.revision,
    });
    expect(quoteRoute(quoteInput('gemini-3.5-flash', { policyProfile: 'wide' }), { profiles }))
      .toMatchObject({ maxAttempts: 8, policyRevision: 'rev-8' });
    expect(quoteRoute(quoteInput('gemini-3.5-flash', { policyProfile: 'single' }), { profiles }))
      .toMatchObject({ maxAttempts: 1, policyRevision: 'rev-1' });
    expect(() => quoteRoute(quoteInput('gemini-3.5-flash', { policyOverride: { maxAttempts: 9 } })))
      .toThrow(RoutePolicyError);
    expect(() => quoteRoute(quoteInput('gemini-3.5-flash', { policyOverride: { maxAttempts: 0 } })))
      .toThrow(RoutePolicyError);
  });

  it('raises each quote error code', () => {
    expectQuoteError(() => quoteRoute(quoteInput('unknown-contract-model')), 'unknown-model');
    expectQuoteError(() => quoteRoute(quoteInput('gemini-3.5-flash', {
      requiredCapabilities: ['input:audio'],
    })), 'capabilities-unmet');
    const invalid: RouteQuoteInput['ceiling'][] = [
      { inputTokens: -1, outputTokens: 10 },
      { inputTokens: 0, outputTokens: 0 },
      { inputTokens: 1.5, outputTokens: 10 },
      { inputTokens: 0, outputTokens: Number.POSITIVE_INFINITY },
      { inputTokens: Number.NaN, outputTokens: 10 },
      { inputTokens: 0, outputTokens: 10, reasoningTokens: -1 },
      { inputTokens: 0, outputTokens: 10, imageUnits: 0.5 },
      { inputTokens: 0, outputTokens: 10, toolCalls: -2 },
    ];
    invalid.forEach((entry) => expectQuoteError(
      () => quoteRoute(quoteInput('gemini-3.5-flash', { ceiling: entry })), 'invalid-ceiling',
    ));
    expectQuoteError(() => quoteRoute(quoteInput('gemini-3.5-flash', {
      now: new Date(Number.NaN),
    })), 'invalid-ceiling');
    expectQuoteError(() => quoteRoute(quoteInput('gemini-3.7-flash', {
      ceiling: { inputTokens: 1_000_001, outputTokens: 10 },
    })), 'invalid-ceiling');
    expect(quoteRoute(quoteInput('gemini-3.7-flash', {
      ceiling: { inputTokens: 1_000_000, outputTokens: 10 },
    })).candidates[0]!.allowance.inputTokens).toBe(1_000_000);
    expectQuoteError(() => quoteRoute(quoteInput('gemini-3.5-flash', {
      targetCandidatesOverride: Array.from({ length: 17 }, (_, index) => ({
        providerId: 'gemini', transportProviderId: 'cloud-code', model: `m-${index}`,
      })),
      policyOverride: { allowEquivalentModels: false },
    })), 'too-many-candidates');
  });

  it('bounds output by the only profiles that declare maxOutputTokens', () => {
    expect(modelProfiles
      .filter((profile) => profile.capabilities.maxOutputTokens !== undefined)
      .map((profile) => `${profile.providerId}/${profile.modelId}=${profile.capabilities.maxOutputTokens}`))
      .toEqual(['gemini/gemini-3.7-flash=65536', 'gemini/gemini-3.8-flash=65536']);
    const capped = quoteRoute(quoteInput('gemini-3.8-flash'));
    expect(capped.candidates[0]!.allowance.outputTokens).toBe(65_536);
    const below = quoteRoute(quoteInput('gemini-3.8-flash', {
      ceiling: { inputTokens: 10, outputTokens: 2_000 },
    }));
    expect(below.candidates[0]!.allowance.outputTokens).toBe(2_000);
  });

  it('flags exactly the codex-servable candidates as output-ceiling unenforced', () => {
    const flagged = new Set<string>();
    const refused: string[] = [];
    for (const requestedModel of requestedModels) {
      let quote: RouteQuote;
      try {
        quote = quoteRoute(quoteInput(requestedModel));
      } catch (error) {
        refused.push(`${requestedModel}:${(error as RouteQuoteError).code}`);
        continue;
      }
      for (const candidate of quote.candidates) {
        const key = `${candidate.providerId}/${candidate.modelId}@${candidate.transportProviderId ?? '*'}`;
        if (!candidate.outputCeilingEnforced) flagged.add(key);
        expect(candidate.outputCeilingEnforced).toBe(!(candidate.transportProviderId === 'codex'
          || (candidate.transportProviderId === undefined && candidate.providerId === 'openai')));
      }
    }
    expect([...flagged].sort()).toEqual(EXPECTED_UNENFORCED);
    // Every shipped route id and profile fits the 16-candidate bound.
    expect(refused).toEqual([]);
  });

  it('quotes a superset of every plan across fallback, policies, capabilities and council', async () => {
    const variants = [
      { policyOverride: { maxAttempts: 8 } },
      { policyOverride: { maxAttempts: 8, fallbackMode: 'one-way' as const } },
      { policyOverride: { maxAttempts: 8, strategy: { kind: 'round-robin' as const, scope: 'new-affinity' as const } } },
      { policyOverride: { maxAttempts: 8, allowEquivalentModels: false } },
      { policyOverride: { maxAttempts: 8 }, requiredCapabilities: ['tools' as const] },
    ];
    const routes = (plan: RoutePlan) => plan.diagnostics.map((entry) => `${entry.actualProviderId}/`
      + `${entry.actualModelId}@${entry.actualTransportProviderId}#${entry.diagnosticAccountRef}`);
    let plansChecked = 0; let equivalentsPlanned = 0;
    for (const requestedModel of requestedModels) {
      for (const variant of variants) {
        const planner = new InMemoryRoutePlanner({
          directory: new FakeRouteDirectory(broadAccounts()), clock: fixedClock, council: SUPERSET_COUNCIL,
        });
        // Planner clock after the expiring group: the pinned plan must still follow the quote.
        const skewed = new InMemoryRoutePlanner({
          directory: new FakeRouteDirectory(broadAccounts()), clock: skewedClock, council: SUPERSET_COUNCIL,
        });
        let quote: RouteQuote;
        try { quote = planner.quote(quoteInput(requestedModel, variant)); } catch { continue; }
        expect(skewed.quote(quoteInput(requestedModel, variant))).toEqual(quote);
        expect(quote.candidates.length).toBeLessThanOrEqual(MAX_ROUTE_QUOTE_CANDIDATES);
        const ordered = variant.policyOverride.strategy === undefined;
        // Suppress each first route in turn to walk the fallback chain.
        for (let round = 0; round < 4; round += 1) {
          let plan;
          try { plan = await planner.plan(routingSubject(), { requestedModel, ...variant }); } catch { break; }
          plansChecked += 1;
          equivalentsPlanned += plan.diagnostics.filter((entry) => entry.reason === 'equivalent').length;
          expect(plan.candidateRefs.length).toBeLessThanOrEqual(quote.maxAttempts);
          for (const diagnostic of plan.diagnostics) {
            expect(quoted(quote, diagnostic), `${requestedModel} -> ${diagnostic.actualProviderId}/`
              + `${diagnostic.actualModelId}@${diagnostic.actualTransportProviderId}`).toBe(true);
          }
          const pinned = await planner.plan(routingSubject(), { requestedModel, ...variant, quote });
          expect(pinned.diagnostics.every((entry) => quoted(quote, entry))).toBe(true);
          // Round-robin rotates by the reservations of the previous plan, so only ordered strategies compare.
          if (ordered) expect(routes(pinned)).toEqual(routes(plan));
          const skewedPlan = await skewed.plan(routingSubject(), { requestedModel, ...variant, quote });
          expect(skewedPlan.diagnostics.every((entry) => quoted(quote, entry))).toBe(true);
          expect(skewedPlan.candidateRefs.length).toBeLessThanOrEqual(quote.maxAttempts);
          if (ordered) expect(routes(skewedPlan), requestedModel).toEqual(routes(plan));
          const failed = routes(plan)[0];
          const skewedIndex = Math.max(0, routes(skewedPlan).indexOf(failed!));
          for (const [owner, entry, index] of [
            [planner, plan, 0], [skewed, skewedPlan, skewedIndex],
          ] as const) {
            await (await owner.prepareAttempt(
              routingSubject(), entry.planRef, entry.candidateRefs[index]!, `req-${round}`, index,
            )).recordOutcome({ reason: 'provider-5xx', retryable: true, healthScope: 'route' });
          }
        }
      }
    }
    expect(plansChecked).toBeGreaterThan(100);
    expect(equivalentsPlanned).toBeGreaterThan(0);
  });

  it('refuses a quote that does not match the plan before touching accounts', async () => {
    const directory = new SpyDirectory(new FakeRouteDirectory());
    const profiles = new InMemoryRoutePolicyProfiles([
      { name: 'p', revision: 'rev-1', policy: DEFAULT_ROUTE_POLICY },
    ]);
    const planner = new InMemoryRoutePlanner({ directory, profiles, clock: fixedClock });
    const input = quoteInput('gemini-3.5-flash', { policyProfile: 'p' });
    const quote = planner.quote(input);
    const plan = (extra: Record<string, unknown>) => planner.plan(routingSubject(), {
      requestedModel: 'gemini-3.5-flash', policyProfile: 'p', quote, ...extra,
    });
    const tampered: RouteQuote[] = [
      { ...quote, maxAttempts: 8 },
      { ...quote, candidates: [...quote.candidates, { ...quote.candidates[0]!, modelId: 'gemini-3.7-flash' }] },
      { ...quote, councilRevision: 'other' },
      { ...quote, policyRevision: 'default' },
      { ...quote, requestedModel: 'gemini-3.7-flash' },
    ];
    for (const entry of tampered) {
      await expect(plan({ quote: entry })).rejects.toMatchObject({ code: 'quote-mismatch' });
    }
    await expect(plan({ policyOverride: { maxAttempts: 8 } }))
      .rejects.toMatchObject({ code: 'quote-mismatch' });
    await expect(plan({ requestedModel: 'gemini-3.7-flash' }))
      .rejects.toMatchObject({ code: 'quote-mismatch' });
    profiles.set({ name: 'p', revision: 'rev-2', policy: DEFAULT_ROUTE_POLICY });
    await expect(plan({})).rejects.toBeInstanceOf(RoutePlanError);
    await expect(plan({})).rejects.toMatchObject({ code: 'quote-mismatch' });
    const otherCouncil = new InMemoryRoutePlanner({
      directory, profiles, clock: fixedClock,
      council: { ...DEFAULT_MODEL_EQUIVALENCE_COUNCIL, revision: 'council-next' },
    });
    await expect(otherCouncil.plan(routingSubject(), {
      requestedModel: 'gemini-3.5-flash', policyProfile: 'p', quote: planner.quote(input),
    })).rejects.toMatchObject({ code: 'quote-mismatch' });
    expect(directory.calls).toEqual([]);
  });

  it('ignores an affinity to an unquoted target and plans among quoted candidates', async () => {
    const accounts: EligibleAccountDescriptor[] = [
      {
        accountRef: 'internal-a', diagnosticAccountRef: 'acct_a', targetProviderId: 'gemini',
        transportProviderId: 'cloud-code', supportedModelIds: ['gemini-3.7-flash'],
        enrollmentCompletedAt: '2026-08-01T00:00:00Z', readiness: 'ready', revision: 'r1',
      },
      {
        accountRef: 'internal-b', diagnosticAccountRef: 'acct_b', targetProviderId: 'gemini',
        transportProviderId: 'cloud-code', supportedModelIds: ['gemini-3.5-flash'],
        enrollmentCompletedAt: '2026-08-02T00:00:00Z', readiness: 'ready', revision: 'r1',
      },
    ];
    const directory = new FakeRouteDirectory(accounts);
    const planner = new InMemoryRoutePlanner({ directory, clock: fixedClock });
    const policyOverride = { allowEquivalentModels: false };
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'gemini-3.7-flash', affinityKey: 'session', policyOverride,
    });
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-a', 0,
    )).complete();

    // Without a quote the sticky behavior is unchanged (attention item for the mesh owner).
    const unpinned = await planner.plan(routingSubject(), {
      requestedModel: 'gemini-3.5-flash', affinityKey: 'session', policyOverride,
    });
    expect(unpinned.diagnostics.map((entry) => entry.actualModelId)).toEqual(['gemini-3.7-flash']);

    const quote = planner.quote(quoteInput('gemini-3.5-flash', { policyOverride }));
    expect(quote.candidates.map((candidate) => candidate.modelId)).toEqual(['gemini-3.5-flash']);
    const pinned = await planner.plan(routingSubject(), {
      requestedModel: 'gemini-3.5-flash', affinityKey: 'session', policyOverride, quote,
    });
    expect(pinned.diagnostics.map((entry) => [entry.diagnosticAccountRef, entry.actualModelId]))
      .toEqual([['acct_b', 'gemini-3.5-flash']]);
    const before = directory.prepared.length;
    await (await planner.prepareAttempt(
      routingSubject(), pinned.planRef, pinned.candidateRefs[0]!, 'req-b', 0,
    )).complete();
    expect(directory.prepared.slice(before).map((entry) => [entry.accountRef, entry.target.modelId]))
      .toEqual([['internal-b', 'gemini-3.5-flash']]);
  });

  it('keeps a quoted sticky affinity when the quote covers it', async () => {
    const planner = new InMemoryRoutePlanner({ directory: new FakeRouteDirectory(), clock: fixedClock });
    const first = await planner.plan(routingSubject(), {
      requestedModel: 'gemini-3.5-flash', affinityKey: 'session',
    });
    const boundRef = first.diagnostics[0]!.diagnosticAccountRef;
    await (await planner.prepareAttempt(
      routingSubject(), first.planRef, first.candidateRefs[0]!, 'req-a', 0,
    )).complete();
    const quote = planner.quote(quoteInput('gemini-3.5-flash'));
    const pinned = await planner.plan(routingSubject(), {
      requestedModel: 'gemini-3.5-flash', affinityKey: 'session', quote,
    });
    expect(pinned.diagnostics[0]).toMatchObject({ reason: 'sticky', diagnosticAccountRef: boundRef });
  });

  it('evaluates council freshness at the quote instant, not the planner clock', async () => {
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory(broadAccounts()), clock: skewedClock, council: SUPERSET_COUNCIL,
    });
    const input = quoteInput('mistral-small-2603', { policyOverride: { maxAttempts: 8 } });
    const quote = planner.quote(input);
    expect(quote.quotedAt).toBe(NOW.toISOString());
    expect(quote.candidates.map((candidate) => candidate.modelId))
      .toEqual(['mistral-small-2603', 'magistral-medium-2509']);
    const unpinned = await planner.plan(routingSubject(), { requestedModel: 'mistral-small-2603',
      policyOverride: { maxAttempts: 8 } });
    expect(new Set(unpinned.diagnostics.map((entry) => entry.actualModelId)))
      .toEqual(new Set(['mistral-small-2603']));
    const pinned = await planner.plan(routingSubject(), { requestedModel: 'mistral-small-2603',
      policyOverride: { maxAttempts: 8 }, quote });
    expect(new Set(pinned.diagnostics.map((entry) => entry.actualModelId)))
      .toEqual(new Set(['mistral-small-2603', 'magistral-medium-2509']));
    await expect(planner.plan(routingSubject(), { requestedModel: 'mistral-small-2603',
      policyOverride: { maxAttempts: 8 }, quote: { ...quote, quotedAt: SKEWED.toISOString() } }))
      .rejects.toMatchObject({ code: 'quote-mismatch' });
  });

  it('caps pinned attempts at the quoted maximum when the policy grows', async () => {
    const profiles = new InMemoryRoutePolicyProfiles([
      { name: 'p', revision: 'rev-1', policy: { ...DEFAULT_ROUTE_POLICY, maxAttempts: 3 } },
    ]);
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory(broadAccounts()), profiles, clock: fixedClock,
    });
    const quote = planner.quote(quoteInput('gemini-3.5-flash', { policyProfile: 'p' }));
    expect(quote.maxAttempts).toBe(3);
    profiles.set({ name: 'p', revision: 'rev-1', policy: { ...DEFAULT_ROUTE_POLICY, maxAttempts: 8 } });
    const unpinned = await planner.plan(routingSubject(), {
      requestedModel: 'gemini-3.5-flash', policyProfile: 'p',
    });
    expect(unpinned.candidateRefs.length).toBeGreaterThan(3);
    const pinned = await planner.plan(routingSubject(), {
      requestedModel: 'gemini-3.5-flash', policyProfile: 'p', quote,
    });
    expect(pinned.candidateRefs.length).toBeLessThanOrEqual(3);
    expect(pinned.policy.maxAttempts).toBe(3);
  });

  it('ignores explicit.diagnosticAccountRef in the quote but narrows the plan', async () => {
    const planner = new InMemoryRoutePlanner({
      directory: new FakeRouteDirectory(broadAccounts()), clock: fixedClock,
    });
    const explicit = { diagnosticAccountRef: 'acct_gemini_antigravity' };
    const quote = planner.quote(quoteInput('gemini-3.5-flash', { explicit }));
    expect(quote.candidates).toEqual(planner.quote(quoteInput('gemini-3.5-flash')).candidates);
    const plan = await planner.plan(routingSubject(), {
      requestedModel: 'gemini-3.5-flash', explicit, quote,
    });
    expect(plan.diagnostics.map((entry) => entry.diagnosticAccountRef))
      .toEqual(['acct_gemini_antigravity']);
  });

  it('treats requiredCapabilities order as irrelevant for the quote reference', async () => {
    const planner = new InMemoryRoutePlanner({ directory: new FakeRouteDirectory(), clock: fixedClock });
    const quote = planner.quote(quoteInput('gemini-3.5-flash', { requiredCapabilities: ['tools', 'input:image'] }));
    expect(planner.quote(quoteInput('gemini-3.5-flash', { requiredCapabilities: ['input:image', 'tools'] })).quoteRef)
      .toBe(quote.quoteRef);
    const plan = await planner.plan(routingSubject(), {
      requestedModel: 'gemini-3.5-flash', requiredCapabilities: ['input:image', 'tools'], quote,
    });
    expect(plan.candidateRefs.length).toBeGreaterThan(0);
  });
});

// Codex-pinned alias targets plus unpinned OpenAI profiles (codex is OpenAI's only account transport).
const EXPECTED_UNENFORCED = [
  'openai/gpt-4.1-nano@*',
  'openai/gpt-5.4-nano@*',
  'openai/gpt-5.5@*',
  'openai/gpt-5.6-luna@codex',
  'openai/gpt-5.6-sol@codex',
  'openai/gpt-5.6-terra@codex',
  'openai/gpt-6-astra@codex',
  'openai/gpt-6-luna@codex',
  'openai/gpt-6-sol@codex',
];
