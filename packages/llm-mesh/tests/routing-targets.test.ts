import { describe, expect, it } from 'vitest';
import {
  createCanonicalTargetResolver,
  describeCanonicalTargetRoutes,
} from '../src/routing-targets.js';

describe('canonical model targets', () => {
  const resolve = createCanonicalTargetResolver();

  it('keeps bare ids provider-faithful', () => {
    expect(resolve('claude-opus-5')).toEqual({
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-opus-5',
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

  it('describes routes without account or credential fields', () => {
    expect(JSON.stringify(describeCanonicalTargetRoutes())).not.toMatch(
      /token|secret|accountId/i,
    );
  });
});
