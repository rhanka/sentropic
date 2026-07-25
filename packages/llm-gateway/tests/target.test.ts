/**
 * Terra launch-alias routing (single source of truth in the gateway target-map).
 * The Claude-compat launch aliases `claude-opus-4-8` and `claude-opus-4-8-xhigh`
 * resolve to the OpenAI upstream `gpt-5.6-terra` at effort `xhigh`, with NO
 * silent cross-pool fallback (unknown id -> undefined -> router 400). The
 * provider-faithful DEFAULT keeps `claude-opus-4-8` as the real Anthropic model
 * unless the launch-alias map is merged over it.
 */

import { describe, expect, it } from 'vitest';

import {
  createStaticTargetResolver,
  DEFAULT_TARGET_MAPPINGS,
  LAUNCH_ALIAS_TARGET_MAPPINGS,
} from '../src/index.js';

describe('Terra launch-alias target-map', () => {
  const resolve = createStaticTargetResolver({
    mappings: { ...DEFAULT_TARGET_MAPPINGS, ...LAUNCH_ALIAS_TARGET_MAPPINGS },
  });

  it('routes claude-opus-4-8 (launch alias) to gpt-5.6-terra at xhigh', () => {
    expect(resolve('claude-opus-4-8')).toEqual({
      providerId: 'openai',
      transportProviderId: 'codex',
      model: 'gpt-5.6-terra',
      effort: 'xhigh',
    });
  });

  it('routes claude-opus-4-8-xhigh to gpt-5.6-terra at xhigh', () => {
    expect(resolve('claude-opus-4-8-xhigh')).toEqual({
      providerId: 'openai',
      transportProviderId: 'codex',
      model: 'gpt-5.6-terra',
      effort: 'xhigh',
    });
  });

  it('never silently falls back cross-pool: unknown id -> undefined', () => {
    expect(resolve('gemini-3.1-pro')).toBeUndefined();
    expect(resolve('claude-opus-4-8-ultra')).toBeUndefined();
  });

  it('keeps the provider-faithful DEFAULT for claude-opus-4-8 without the alias map', () => {
    const faithful = createStaticTargetResolver({ mappings: DEFAULT_TARGET_MAPPINGS });
    expect(faithful('claude-opus-4-8')).toEqual({
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-opus-4-8',
    });
  });
});
