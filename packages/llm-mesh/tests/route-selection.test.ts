import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_EQUIVALENCE_COUNCIL } from '../src/equivalence-council.js';
import { selectRouteCandidates } from '../src/route-selection.js';
import { DEFAULT_ROUTE_POLICY } from '../src/routing-policy.js';

const accounts = [
  {
    accountRef: 'internal-old',
    diagnosticAccountRef: 'acct_old',
    targetProviderId: 'gemini',
    transportProviderId: 'cloud-code',
    supportedModelIds: ['gemini-3.5-flash'],
    enrollmentCompletedAt: '2026-08-01T00:00:00Z',
    readiness: 'ready' as const,
    revision: 'r1',
  },
  {
    accountRef: 'internal-new',
    diagnosticAccountRef: 'acct_new',
    targetProviderId: 'gemini',
    transportProviderId: 'antigravity',
    supportedModelIds: ['gemini-3.5-flash'],
    enrollmentCompletedAt: '2026-08-02T00:00:00Z',
    readiness: 'ready' as const,
    revision: 'r1',
  },
];

const candidatesOf = (selection: ReturnType<typeof selectRouteCandidates>) => {
  if (selection.kind !== 'candidates') throw new Error(`Expected candidates, got ${selection.kind}`);
  return selection.candidates;
};

const select = (policy = DEFAULT_ROUTE_POLICY, roundRobinOffset = 0) =>
  candidatesOf(selectRouteCandidates({
    request: { requestedModel: 'gemini-3.5-flash' },
    policy,
    council: DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
    accounts,
    roundRobinOffset,
  }));

describe('route candidate selection', () => {
  it('tries the last enrolled account first by default', () => {
    const candidates = select();
    expect(candidates.map((candidate) => candidate.account.diagnosticAccountRef))
      .toEqual(['acct_new', 'acct_old']);
    expect(JSON.stringify(candidates)).not.toMatch(/accessToken|refreshToken|keyring/);
  });

  it('honors an explicit ordered transport preference', () => {
    const candidates = select({
      ...DEFAULT_ROUTE_POLICY,
      strategy: {
        kind: 'ordered',
        preferences: [
          { transportProviderId: 'cloud-code' },
          { transportProviderId: 'antigravity' },
        ],
      },
    });
    expect(candidates[0]?.target.transportProviderId).toBe('cloud-code');
  });

  it('uses the next canonical fallback only when no Anthropic account is enrolled', () => {
    const launchAccounts = [
      {
        accountRef: 'codex-internal',
        diagnosticAccountRef: 'codex-redacted',
        targetProviderId: 'openai',
        transportProviderId: 'codex',
        supportedModelIds: ['gpt-5.6-sol'],
        enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready' as const,
        revision: 'r1',
      },
      {
        accountRef: 'cloud-internal',
        diagnosticAccountRef: 'cloud-redacted',
        targetProviderId: 'gemini',
        transportProviderId: 'cloud-code',
        supportedModelIds: ['gemini-3.7-flash'],
        enrollmentCompletedAt: '2026-08-02T00:00:00Z',
        readiness: 'ready' as const,
        revision: 'r1',
      },
    ];
    const candidates = candidatesOf(selectRouteCandidates({
      request: {
        requestedModel: 'claude-opus-5-xhigh',
        requiredCapabilities: ['tools', 'streaming'],
      },
      policy: DEFAULT_ROUTE_POLICY,
      council: DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
      accounts: launchAccounts,
    }));

    expect(candidates.map((candidate) => candidate.target.transportProviderId)).toEqual(['codex']);
  });

  it('routes Fable 5.1 max to GPT-6 Astra max when no Anthropic account is enrolled', () => {
    const candidates = candidatesOf(selectRouteCandidates({
      request: { requestedModel: 'claude-fable-5-1-max' },
      policy: DEFAULT_ROUTE_POLICY,
      council: DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
      accounts: [{
        accountRef: 'codex-internal', diagnosticAccountRef: 'codex-redacted',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-6-astra'],
        enrollmentCompletedAt: '2026-09-03T00:00:00Z',
        readiness: 'ready', revision: 'r1',
      }],
    }));

    expect(candidates[0]?.target).toMatchObject({
      providerId: 'openai', transportProviderId: 'codex',
      modelId: 'gpt-6-astra', effort: 'max', reason: 'alias',
    });
  });

  it('uses a non-Anthropic fallback when faithful Anthropic account is unavailable', () => {
    const selection = selectRouteCandidates({
      request: {
        requestedModel: 'claude-sonnet-4-6',
        requiredCapabilities: ['tools', 'streaming'],
      },
      policy: DEFAULT_ROUTE_POLICY,
      council: DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
      accounts: [{
        accountRef: 'codex-internal',
        diagnosticAccountRef: 'codex-redacted',
        targetProviderId: 'openai',
        transportProviderId: 'codex',
        supportedModelIds: ['gpt-5.6-luna'],
        enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready',
        revision: 'r1',
      }],
    });

    expect(selection.kind).toBe('candidates');
    expect(selection.candidates[0]).toMatchObject({
      target: { providerId: 'openai', modelId: 'gpt-5.6-luna' },
    });
  });

  it('allows an owner-scoped target profile override for a non-Claude model', () => {
    const candidates = candidatesOf(selectRouteCandidates({
      request: {
        requestedModel: 'gemini-3.5-flash',
        targetCandidatesOverride: [{
          providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.1-flash-lite',
        }],
      },
      policy: DEFAULT_ROUTE_POLICY,
      council: DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
      accounts: [{
        accountRef: 'cloud-internal', diagnosticAccountRef: 'cloud-redacted',
        targetProviderId: 'gemini', transportProviderId: 'cloud-code',
        supportedModelIds: ['gemini-3.1-flash-lite'],
        enrollmentCompletedAt: '2026-08-02T00:00:00Z', readiness: 'ready', revision: 'r1',
      }],
    }));

    expect(candidates[0]?.target.modelId).toBe('gemini-3.1-flash-lite');
  });

  it('keeps a bare provider model faithful when another transport is preferred', () => {
    const candidates = candidatesOf(selectRouteCandidates({
      request: { requestedModel: 'gpt-5.6-terra' },
      policy: {
        ...DEFAULT_ROUTE_POLICY,
        strategy: {
          kind: 'ordered',
          preferences: [
            { transportProviderId: 'cloud-code' },
            { transportProviderId: 'codex' },
          ],
        },
      },
      council: DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
      accounts: [{
        accountRef: 'codex-internal',
        diagnosticAccountRef: 'codex-redacted',
        targetProviderId: 'openai',
        transportProviderId: 'codex',
        supportedModelIds: ['gpt-5.6-terra'],
        enrollmentCompletedAt: '2026-08-01T00:00:00Z',
        readiness: 'ready',
        revision: 'r1',
      }],
    }));

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.target).toMatchObject({
      providerId: 'openai',
      modelId: 'gpt-5.6-terra',
      transportProviderId: 'codex',
      reason: 'exact',
    });
  });

  it('rotates only the starting candidate for a new affinity', () => {
    const policy = {
      ...DEFAULT_ROUTE_POLICY,
      strategy: { kind: 'round-robin' as const, scope: 'new-affinity' as const },
    };
    expect(select(policy, 0)[0]?.account.diagnosticAccountRef).toBe('acct_new');
    expect(select(policy, 1)[0]?.account.diagnosticAccountRef).toBe('acct_old');
  });

  it('applies the first matching per-model rule', () => {
    const candidates = select({
      ...DEFAULT_ROUTE_POLICY,
      rules: [{
        match: { requestedModel: 'gemini-3.5-flash' },
        preferences: [{ transportProviderId: 'cloud-code' }],
      }],
    });
    expect(candidates[0]?.target.transportProviderId).toBe('cloud-code');
  });

  it('applies a capability rule reconstructed from JSON by structural value', () => {
    const requiredCapabilities = JSON.parse(
      '[{"required":true,"capability":"input:image"}]',
    );
    const candidates = candidatesOf(selectRouteCandidates({
      request: { requestedModel: 'gemini-3.5-flash', requiredCapabilities },
      policy: {
        ...DEFAULT_ROUTE_POLICY,
        rules: [{
          match: {
            capabilities: JSON.parse(
              '[{"capability":"input:image","required":true}]',
            ),
          },
          preferences: [{ transportProviderId: 'cloud-code' }],
        }],
      },
      council: DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
      accounts,
    }));

    expect(candidates[0]?.target.transportProviderId).toBe('cloud-code');
  });

  it('rejects an equivalent that cannot preserve a requested capability', () => {
    const candidates = candidatesOf(selectRouteCandidates({
      request: { requestedModel: 'gemini-3.5-flash', requiredCapabilities: ['input:image'] },
      policy: DEFAULT_ROUTE_POLICY,
      council: {
        ...DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
        groups: [{
          id: 'vision-fixture', intent: 'general', expiresAt: '2027-01-01T00:00:00Z',
          evidence: [{
            suite: 'fixture', artifact: 'fixture.json', measuredAt: '2026-08-01T00:00:00Z',
            dimensions: { quality: 'equivalent' },
          }],
          members: [
            { providerId: 'gemini', modelId: 'gemini-3.5-flash', rank: 1, requiredCapabilities: [] },
            { providerId: 'openai', modelId: 'gpt-4.1-nano', rank: 2, requiredCapabilities: [] },
          ],
        }],
      },
      accounts: [...accounts, {
        ...accounts[0]!, accountRef: 'openai-internal', diagnosticAccountRef: 'openai-redacted',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-4.1-nano'],
      }],
    }));

    expect(candidates.map((candidate) => candidate.target.modelId))
      .not.toContain('gpt-4.1-nano');
  });

  it('keeps the exact route but fails closed on stale equivalence evidence', () => {
    const candidates = candidatesOf(selectRouteCandidates({
      request: { requestedModel: 'gemini-3.5-flash' },
      policy: DEFAULT_ROUTE_POLICY,
      council: {
        ...DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
        groups: [{
          id: 'stale-fixture', intent: 'general', expiresAt: '2026-01-01T00:00:00Z',
          evidence: [{
            suite: 'fixture', artifact: 'fixture.json', measuredAt: '2025-01-01T00:00:00Z',
            dimensions: { quality: 'equivalent' },
          }],
          members: [
            { providerId: 'gemini', modelId: 'gemini-3.5-flash', rank: 1, requiredCapabilities: [] },
            { providerId: 'openai', modelId: 'gpt-4.1-nano', rank: 2, requiredCapabilities: [] },
          ],
        }],
      },
      accounts: [...accounts, {
        ...accounts[0]!, accountRef: 'openai-internal', diagnosticAccountRef: 'openai-redacted',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-4.1-nano'],
      }],
      now: new Date('2026-08-08T00:00:00Z'),
    }));

    expect(candidates.map((candidate) => candidate.target.modelId))
      .toEqual(['gemini-3.5-flash', 'gemini-3.5-flash']);
  });

  it('orders exact routes before same-transport equivalents', () => {
    const candidates = candidatesOf(selectRouteCandidates({
      request: { requestedModel: 'gemini-3.5-flash' },
      policy: DEFAULT_ROUTE_POLICY,
      council: {
        ...DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
        groups: [{
          id: 'transport-fixture', intent: 'general', expiresAt: '2027-01-01T00:00:00Z',
          evidence: [{
            suite: 'fixture', artifact: 'fixture.json', measuredAt: '2026-08-01T00:00:00Z',
            dimensions: { quality: 'equivalent' },
          }],
          members: [
            { providerId: 'gemini', modelId: 'gemini-3.5-flash', rank: 1, requiredCapabilities: [] },
            {
              providerId: 'openai', modelId: 'gpt-5.6-terra', rank: 2,
              requiredCapabilities: [], transportPreferences: ['cloud-code', 'codex'],
            },
          ],
        }],
      },
      accounts: [...accounts, {
        ...accounts[0]!, accountRef: 'openai-codex', diagnosticAccountRef: 'openai-codex',
        targetProviderId: 'openai', transportProviderId: 'codex',
        supportedModelIds: ['gpt-5.6-terra'], enrollmentCompletedAt: '2026-08-04T00:00:00Z',
      }, {
        ...accounts[0]!, accountRef: 'openai-cloud', diagnosticAccountRef: 'openai-cloud',
        targetProviderId: 'openai', transportProviderId: 'cloud-code',
        supportedModelIds: ['gpt-5.6-terra'], enrollmentCompletedAt: '2026-08-03T00:00:00Z',
      }],
      now: new Date('2026-08-08T00:00:00Z'),
    }));

    expect(candidates.map((candidate) => candidate.account.diagnosticAccountRef))
      .toEqual(['acct_new', 'acct_old', 'openai-cloud']);
  });

  it('keeps the canonical Anthropic target first when an override tries to route Claude elsewhere', () => {
    const selection = selectRouteCandidates({
      request: {
        requestedModel: 'claude-opus-5',
        targetCandidatesOverride: [{
          providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.7-flash',
        }],
      },
      policy: DEFAULT_ROUTE_POLICY,
      council: DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
      accounts: [
        {
          accountRef: 'anthropic-internal', diagnosticAccountRef: 'anthropic-redacted',
          targetProviderId: 'anthropic', transportProviderId: 'claude-code',
          supportedModelIds: ['claude-opus-5'], enrollmentCompletedAt: '2026-08-01T00:00:00Z',
          readiness: 'ready', revision: 'r1',
        },
        {
          accountRef: 'cloud-internal', diagnosticAccountRef: 'cloud-redacted',
          targetProviderId: 'gemini', transportProviderId: 'cloud-code',
          supportedModelIds: ['gemini-3.7-flash'], enrollmentCompletedAt: '2026-08-02T00:00:00Z',
          readiness: 'ready', revision: 'r1',
        },
      ],
    });

    expect(selection.kind).toBe('candidates');
    if (selection.kind === 'candidates') {
      expect(selection.candidates[0]?.target.providerId).toBe('anthropic');
      expect(selection.candidates).toHaveLength(1);
    }
  });

  it('distinguishes unknown ids, unmet capabilities, and no eligible account', () => {
    const selectSignal = (request: Parameters<typeof selectRouteCandidates>[0]['request'], accountsForSignal = accounts) =>
      selectRouteCandidates({
        request,
        policy: DEFAULT_ROUTE_POLICY,
        council: DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
        accounts: accountsForSignal,
      });

    expect(selectSignal({
      requestedModel: 'unknown-contract-model',
      targetCandidatesOverride: [{
        providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra',
      }],
    })).toMatchObject({ kind: 'unknown-model' });
    expect(selectSignal({
      requestedModel: 'gemini-3.5-flash', requiredCapabilities: ['input:audio'],
    })).toMatchObject({ kind: 'capabilities-unmet' });
    expect(selectSignal({ requestedModel: 'gemini-3.5-flash' }, [])).toMatchObject({
      kind: 'no-eligible-account',
    });
  });
});
