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
    expect(resolve('gemini-3.8-flash')).toEqual({
      providerId: 'gemini',
      transportProviderId: 'cloud-code',
      model: 'gemini-3.8-flash',
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
        providerId: 'muse',
        transportProviderId: 'muse',
        model: 'muse-spark-1.3-contributor',
        effort: 'xhigh',
      },
      {
        providerId: 'openai',
        transportProviderId: 'codex',
        model: 'gpt-6-astra',
        effort: 'medium',
      },
      {
        providerId: 'gemini',
        transportProviderId: 'cloud-code',
        model: 'gemini-3.8-flash',
        effort: 'high',
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
        model: 'gemini-3.8-flash',
        effort: 'high',
      },
    ]);
    expect(resolveCandidates('claude-fable-5')).toEqual([
      {
        providerId: 'anthropic',
        transportProviderId: 'claude-code',
        model: 'claude-fable-5',
      },
      {
        providerId: 'muse',
        transportProviderId: 'muse',
        model: 'muse-spark-1.3-contributor',
        effort: 'max',
      },
      {
        providerId: 'openai',
        transportProviderId: 'codex',
        model: 'gpt-6-astra',
      },
      {
        providerId: 'gemini',
        transportProviderId: 'cloud-code',
        model: 'gemini-3.8-flash',
        effort: 'high',
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
      'claude-opus-5-max',
      'claude-opus-4-8', 'claude-opus-4-8-xhigh', 'claude-opus-4-8-max',
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
        providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.8-flash',
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
    for (const definition of STANDARD_ROUTE_DEFINITIONS) {
      const candidates = resolveCandidates(definition.requestedId);
      const faithfulTarget = faithfulAnthropicTargetFromCandidates(candidates);
      expect(faithfulTarget).toBeDefined();
      expect(faithfulTarget).toMatchObject({
        providerId: 'anthropic',
        transportProviderId: 'claude-code',
      });
    }
  });

  it('preserves effort and never uses Flash Lite for standard aliases', () => {
    for (const [alias, primaryTarget] of Object.entries(LAUNCH_ALIAS_TARGET_MAPPINGS)) {
      const candidates = resolveCandidates(alias);
      const faithfulCandidate = candidates.find(
        (candidate) => candidate.transportProviderId === 'claude-code',
      );
      expect(faithfulCandidate?.effort).toBe(primaryTarget.effort);
      expect(candidates.map((candidate) => candidate.model))
        .not.toContain('gemini-3.1-flash-lite');
    }
  });

  it('routes every Fable 5 and 5.1 fallback through the GA models', () => {
    for (const model of ['claude-fable-5', 'claude-fable-5-1']) {
      for (const effort of [undefined, 'high', 'xhigh', 'max'] as const) {
        const alias = effort ? `${model}-${effort}` : model;
        const candidates = resolveCandidates(alias);
        expect(candidates[1]).toEqual({
          providerId: 'muse', transportProviderId: 'muse',
          model: 'muse-spark-1.3-contributor', effort: 'max',
        });
        expect(candidates[2]).toEqual({
          providerId: 'openai', transportProviderId: 'codex',
          model: 'gpt-6-astra', ...(effort ? { effort } : {}),
        });
        expect(candidates[3]).toEqual({
          providerId: 'gemini', transportProviderId: 'cloud-code',
          model: 'gemini-3.8-flash', effort: 'high',
        });
      }
    }
  });

  it('routes Opus 5 base through Sol and high/xhigh through Astra medium', () => {
    expect(resolveCandidates('claude-opus-5')[1]).toEqual({
      providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-sol',
    });
    for (const effort of ['high', 'xhigh'] as const) {
      const candidates = resolveCandidates(`claude-opus-5-${effort}`);
      expect(candidates[2]).toEqual({
        providerId: 'openai', transportProviderId: 'codex',
        model: 'gpt-6-astra', effort: 'medium',
      });
      expect(candidates[3]).toEqual({
        providerId: 'gemini', transportProviderId: 'cloud-code',
        model: 'gemini-3.8-flash', effort: 'high',
      });
    }
  });

  it('routes new Opus max aliases through Astra high with a muse max candidate', () => {
    for (const model of ['claude-opus-5', 'claude-opus-4-8']) {
      const candidates = resolveCandidates(`${model}-max`);
      expect(candidates).toEqual([
        {
          providerId: 'anthropic', transportProviderId: 'claude-code',
          model, effort: 'max',
        },
        {
          providerId: 'muse', transportProviderId: 'muse',
          model: 'muse-spark-1.3-contributor', effort: 'max',
        },
        {
          providerId: 'openai', transportProviderId: 'codex',
          model: 'gpt-6-astra', effort: 'high',
        },
        {
          providerId: 'gemini', transportProviderId: 'cloud-code',
          model: 'gemini-3.8-flash', effort: 'high',
        },
      ]);
    }
  });

  it('routes every Claude tier to 3.8 Flash on the Cloud Code transport', () => {
    const aliases = [
      'claude-opus-5', 'claude-opus-5-high', 'claude-opus-5-xhigh',
      'claude-opus-5-max',
      'claude-opus-4-8', 'claude-opus-4-8-xhigh', 'claude-opus-4-8-max',
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
        model: 'gemini-3.8-flash',
      });
      expect(resolveTargetCapabilitySource(cloudCodeTargets[0]!)).toMatchObject({
        providerId: 'gemini',
        transportProviderId: 'cloud-code',
        model: 'gemini-3.8-flash',
      });
    }
  });

  it('keeps bare Muse ids provider-faithful', () => {
    expect(resolve('muse-spark-1.3')).toEqual({
      providerId: 'muse',
      transportProviderId: 'muse',
      model: 'muse-spark-1.3',
    });
    expect(resolve('muse-spark-1.3-contributor')).toEqual({
      providerId: 'muse',
      transportProviderId: 'muse',
      model: 'muse-spark-1.3-contributor',
    });
  });

  it('honors the musePosition integrator option (off | after-claude | first)', () => {
    const off = createCanonicalTargetCandidatesResolver({ musePosition: 'off' });
    expect(off('claude-opus-5-xhigh').map((target) => target.transportProviderId))
      .toEqual(['claude-code', 'codex', 'cloud-code']);

    const first = createCanonicalTargetCandidatesResolver({ musePosition: 'first' });
    expect(first('claude-opus-5-xhigh').map((target) => target.transportProviderId))
      .toEqual(['muse', 'claude-code', 'codex', 'cloud-code']);

    const afterClaude = createCanonicalTargetCandidatesResolver({ musePosition: 'after-claude' });
    expect(afterClaude('claude-opus-5-xhigh').map((target) => target.transportProviderId))
      .toEqual(['claude-code', 'muse', 'codex', 'cloud-code']);
  });

  it('supports the claude-last order (codex, muse, cloud, claude)', () => {
    const last = createCanonicalTargetCandidatesResolver({ musePosition: 'claude-last' });
    expect(last('claude-opus-5-xhigh').map((target) => target.transportProviderId))
      .toEqual(['codex', 'muse', 'cloud-code', 'claude-code']);
    // Aliases without a muse candidate keep codex/cloud/claude order.
    expect(last('claude-sonnet-5').map((target) => target.transportProviderId))
      .toEqual(['codex', 'cloud-code', 'claude-code']);
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
    expect(resolveCandidates('gemini-3.8-flash')).toEqual([{
      providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.8-flash',
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
