import { describe, expect, it } from 'vitest';
import {
  createCanonicalTargetCandidatesResolver,
  createCanonicalTargetResolver,
  describeCanonicalTargetRoutes,
  LAUNCH_ALIAS_TARGET_MAPPINGS,
  resolveTargetCapabilitySource,
} from '../src/routing-targets.js';

describe('canonical model targets', () => {
  const resolve = createCanonicalTargetResolver();
  const resolveCandidates = createCanonicalTargetCandidatesResolver();

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
  });

  it('resolves only ratified suffixed aliases', () => {
    expect(resolve('claude-opus-5-xhigh')).toEqual({
      providerId: 'openai',
      transportProviderId: 'codex',
      model: 'gpt-5.6-terra',
      effort: 'xhigh',
    });
    expect(resolve('claude-opus-4-8-xhigh')).toEqual({
      providerId: 'openai',
      transportProviderId: 'codex',
      model: 'gpt-5.6-terra',
      effort: 'xhigh',
    });
    expect(resolve('claude-sonnet-5-xhigh')).toEqual({
      providerId: 'openai',
      transportProviderId: 'codex',
      model: 'gpt-5.6-luna',
      effort: 'xhigh',
    });
  });

  it('exposes owner-ratified Codex and Cloud Code candidates for launch aliases', () => {
    expect(resolveCandidates('claude-opus-5-xhigh')).toEqual([
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

  it('preserves effort and never uses Flash Lite for standard aliases', () => {
    for (const [alias, codexTarget] of Object.entries(LAUNCH_ALIAS_TARGET_MAPPINGS)) {
      const candidates = resolveCandidates(alias);
      expect(candidates[1]?.effort).toBe(codexTarget.effort);
      expect(candidates.map((candidate) => candidate.model))
        .not.toContain('gemini-3.1-flash-lite');
    }
  });

  it('routes every Claude tier to the real Gemini 3.7 Flash transport', () => {
    const aliases = [
      'claude-opus-5', 'claude-opus-5-high', 'claude-opus-5-xhigh',
      'claude-opus-4-8', 'claude-opus-4-8-xhigh',
      'claude-sonnet-5', 'claude-sonnet-5-xhigh', 'claude-sonnet-4-6',
      'claude-fable-5', 'claude-fable-5-high', 'claude-fable-5-xhigh',
      'claude-fable-5-max',
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
});
