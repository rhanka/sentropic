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
        model: 'claude-opus-4-6-thinking',
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
        model: 'gemini-3.1-pro',
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

  it('keeps the legacy 3.6 capability alias on 3.7 instead of 3.5', () => {
    expect(resolveTargetCapabilitySource({
      providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.6-flash',
    })).toEqual({
      providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.7-flash',
    });
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
