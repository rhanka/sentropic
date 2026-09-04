import { describe, expect, it } from 'vitest';
import {
  type TargetMapping,
  createCanonicalTargetCandidatesResolver,
  createCanonicalTargetResolver,
  STANDARD_ROUTE_DEFINITIONS,
  CANONICAL_TARGET_MAPPINGS,
  describeCanonicalTargetRoutes,
  LAUNCH_ALIAS_TARGET_MAPPINGS,
  LAUNCH_ALIAS_ROUTE_MAPPINGS,
  resolveTargetCapabilitySource,
} from '../src/routing-targets.js';
import { modelProfiles } from '../src/catalog.js';

describe('canonical model targets', () => {
  const resolve = createCanonicalTargetResolver();
  const resolveCandidates = createCanonicalTargetCandidatesResolver();
  const faithfulClaudeModel = (requestedId: string): string =>
    requestedId.replace(/-(?:high|xhigh|max)$/, '');
  const hasModelProfile = (providerId: string, model: string): boolean =>
    modelProfiles.some((candidate) =>
      candidate.providerId === providerId && candidate.modelId === model);
  const faithfulAnthropicTargetFromCandidates = (
    candidates: readonly TargetMapping[],
  ): TargetMapping | undefined =>
    candidates.find((target) =>
      target.providerId === 'anthropic'
      && target.transportProviderId === 'claude-code'
      && hasModelProfile(target.providerId, target.model),
    );

  const expectedSelectionFirstTarget = (requestedId: string): TargetMapping => {
    const canonicalTargets = resolveCandidates(requestedId);
    if (canonicalTargets.length === 0) {
      const profile = modelProfiles.find((candidate) => candidate.modelId === requestedId);
      throw new Error(`No canonical target found for ${requestedId} (${String(profile?.providerId)})`);
    }

    const faithfulClaudeTarget = requestedId.startsWith('claude-')
      ? canonicalTargets.find((target) => (
        target.providerId === 'anthropic'
        && target.transportProviderId === 'claude-code'
        && hasModelProfile(target.providerId, target.model)
      ))
      : undefined;
    if (faithfulClaudeTarget &&
      hasModelProfile(faithfulClaudeTarget.providerId, faithfulClaudeTarget.model)) {
      return faithfulClaudeTarget;
    }

    return canonicalTargets[0]!;
  };

  it('keeps bare ids provider-faithful', () => {
    expect(resolve('claude-opus-5')).toEqual({
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-opus-5',
    });
    expect(resolve('gemini-3.7-flash')).toEqual({
      providerId: 'gemini',
      transportProviderId: 'cloud-code',
      model: 'gemini-3.7-flash',
    });
    expect(resolve('claude-fable-5-1')).toEqual({
      providerId: 'anthropic', transportProviderId: 'claude-code',
      model: 'claude-fable-5-1',
    });
    expect(resolve('gpt-6-astra')).toEqual({
      providerId: 'openai', transportProviderId: 'codex', model: 'gpt-6-astra',
    });
  });

  it('resolves only RATIFICATION PENDING suffixed aliases', () => {
    expect(resolve('claude-opus-5-xhigh')).toEqual({
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-opus-5',
      effort: 'xhigh',
    });
    expect(resolve('claude-opus-4-8-xhigh')).toEqual({
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-opus-4-8',
      effort: 'xhigh',
    });
    expect(resolve('claude-sonnet-5-xhigh')).toEqual({
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-sonnet-5',
      effort: 'xhigh',
    });
  });

  it('exposes RATIFICATION PENDING Codex and Cloud Code candidates for launch aliases', () => {
    expect(resolveCandidates('claude-opus-5-xhigh')).toEqual([
      {
        providerId: 'anthropic',
        transportProviderId: 'claude-code',
        model: 'claude-opus-5',
        effort: 'xhigh',
      },
      {
        providerId: 'openai',
        transportProviderId: 'codex',
        model: 'gpt-5.6-terra',
        effort: 'xhigh',
      },
      {
        providerId: 'gemini',
        transportProviderId: 'cloud-code',
        model: 'gemini-3.7-flash',
        effort: 'xhigh',
      },
    ]);
    expect(resolveCandidates('claude-sonnet-4-6')).toEqual([
      {
        providerId: 'anthropic',
        transportProviderId: 'claude-code',
        model: 'claude-sonnet-5',
      },
      {
        providerId: 'openai',
        transportProviderId: 'codex',
        model: 'gpt-5.6-luna',
      },
      {
        providerId: 'gemini',
        transportProviderId: 'cloud-code',
        model: 'gemini-3.7-flash',
      },
    ]);
    expect(resolveCandidates('claude-fable-5')).toEqual([
      {
        providerId: 'anthropic',
        transportProviderId: 'claude-code',
        model: 'claude-fable-5',
      },
      {
        providerId: 'openai',
        transportProviderId: 'codex',
        model: 'gpt-5.6-sol',
      },
      {
        providerId: 'gemini',
        transportProviderId: 'cloud-code',
        model: 'gemini-3.7-flash',
      },
    ]);
    expect(resolveCandidates('gpt-5.6-terra')).toEqual([
      {
        providerId: 'openai',
        transportProviderId: 'codex',
        model: 'gpt-5.6-terra',
      },
    ]);
  });

  it('keeps faithful Anthropic routes only when profile-backed and keeps canonical alias kind', () => {
    const aliases = [
      'claude-opus-5', 'claude-opus-5-high', 'claude-opus-5-xhigh',
      'claude-opus-4-8', 'claude-opus-4-8-xhigh',
      'claude-sonnet-5', 'claude-sonnet-5-xhigh', 'claude-sonnet-4-6',
      'claude-fable-5', 'claude-fable-5-high', 'claude-fable-5-xhigh',
      'claude-fable-5-max',
      'claude-fable-5-1', 'claude-fable-5-1-high', 'claude-fable-5-1-xhigh',
      'claude-fable-5-1-max',
    ];

    const descriptions = describeCanonicalTargetRoutes();
    for (const alias of aliases) {
      const candidates = resolveCandidates(alias);
      const faithfulTarget = faithfulAnthropicTargetFromCandidates(candidates);
      const expectedPrimary = faithfulTarget ? {
        providerId: 'anthropic',
        transportProviderId: 'claude-code',
      } : {
        providerId: 'openai',
        transportProviderId: 'codex',
      };
      const expectedPrimaryModel = candidates[0]?.model ?? '';
      expect(candidates[0]).toMatchObject(expectedPrimary);
      expect(candidates).toContainEqual(expect.objectContaining({
        providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.7-flash',
      }));
      expect(descriptions.find((route) => route.requestedId === alias))
        .toMatchObject({
          ...expectedPrimary,
          kind: faithfulTarget && alias === expectedPrimaryModel
            ? 'faithful' as const : 'alias' as const,
        });
    }
  });

  it('ensures every launch alias has a faithful Anthropic transport target', () => {
    for (const [requestedId] of STANDARD_ROUTE_DEFINITIONS) {
      const candidates = resolveCandidates(requestedId);
      const faithfulTarget = faithfulAnthropicTargetFromCandidates(candidates);
      expect(faithfulTarget).toBeDefined();
      expect(faithfulTarget).toMatchObject({
        providerId: 'anthropic',
        transportProviderId: 'claude-code',
      });
    }
  });

  it('preserves effort and never uses Flash Lite for standard aliases', () => {
    for (const [alias, codexTarget] of Object.entries(LAUNCH_ALIAS_TARGET_MAPPINGS)) {
      const candidates = resolveCandidates(alias);
      expect(candidates[1]?.effort).toBe(codexTarget.effort);
      expect(candidates.map((candidate) => candidate.model))
        .not.toContain('gemini-3.1-flash-lite');
    }
  });

  it('keeps every Fable 5.1 Codex fallback on GPT-5.6 Sol until GPT-6 GA', () => {
    for (const [alias, effort] of [
      ['claude-fable-5-1', undefined],
      ['claude-fable-5-1-high', 'high'],
      ['claude-fable-5-1-xhigh', 'xhigh'],
      ['claude-fable-5-1-max', 'max'],
    ] as const) {
      const candidates = resolveCandidates(alias);
      expect(candidates[0]).toEqual({
        providerId: 'anthropic', transportProviderId: 'claude-code',
        model: 'claude-fable-5-1', ...(effort ? { effort } : {}),
      });
      expect(candidates[1]).toEqual({
        providerId: 'openai', transportProviderId: 'codex',
        model: 'gpt-5.6-sol', ...(effort ? { effort } : {}),
      });
    }
  });

  it('routes every Claude tier to the real Gemini 3.7 Flash transport', () => {
    const aliases = [
      'claude-opus-5', 'claude-opus-5-high', 'claude-opus-5-xhigh',
      'claude-opus-4-8', 'claude-opus-4-8-xhigh',
      'claude-sonnet-5', 'claude-sonnet-5-xhigh', 'claude-sonnet-4-6',
      'claude-fable-5', 'claude-fable-5-high', 'claude-fable-5-xhigh',
      'claude-fable-5-max',
      'claude-fable-5-1', 'claude-fable-5-1-high', 'claude-fable-5-1-xhigh',
      'claude-fable-5-1-max',
    ];

    for (const alias of aliases) {
      const candidates = resolveCandidates(alias);
      const cloudCodeTargets = candidates.filter(
        ({ transportProviderId }) => transportProviderId === 'cloud-code',
      );
      expect(cloudCodeTargets).toHaveLength(1);
      expect(cloudCodeTargets[0]).toMatchObject({
        providerId: 'gemini',
        transportProviderId: 'cloud-code',
        model: 'gemini-3.7-flash',
      });
      expect(resolveTargetCapabilitySource(cloudCodeTargets[0]!)).toMatchObject({
        providerId: 'gemini',
        transportProviderId: 'cloud-code',
        model: 'gemini-3.7-flash',
      });
    }
  });

  it('keeps legacy Gemini capability aliases on 3.7 instead of 3.5', () => {
    for (const model of ['gemini-3.6-flash', 'gemini-3.1-pro']) {
      expect(resolveTargetCapabilitySource({
        providerId: 'gemini', transportProviderId: 'cloud-code', model,
      })).toEqual({
        providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.7-flash',
      });
    }
    expect(resolveCandidates('gemini-3.7-flash')).toEqual([{
      providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.7-flash',
    }]);
  });

  it('describes routes without account or credential fields', () => {
    expect(JSON.stringify(describeCanonicalTargetRoutes())).not.toMatch(
      /token|secret|accountId/i,
    );
  });

  it('keeps CANONICAL_TARGET_MAPPINGS aligned with the selection-first target for each model', () => {
    for (const [requestedId, canonicalTarget] of Object.entries(CANONICAL_TARGET_MAPPINGS)) {
      expect(canonicalTarget).toEqual(expectedSelectionFirstTarget(requestedId));
    }
  });

  it('keeps launch alias single-target mappings aligned with the first route target', () => {
    for (const [requestedId, targets] of Object.entries(LAUNCH_ALIAS_ROUTE_MAPPINGS)) {
      if (targets.length > 0) {
        const expectedPrimary = expectedSelectionFirstTarget(requestedId);
        expect(
          expectedPrimary.providerId === targets[0]!.providerId
          && expectedPrimary.model === targets[0]!.model
        ).toBe(true);
      }
    }
  });
});
