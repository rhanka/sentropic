/**
 * Launch-alias routing + route DISCOVERY (single source of truth in the gateway
 * target-map). Owner decision 2026-07-25:
 *   - Opus 5  high/xhigh      -> gpt-5.6-terra at the same effort
 *   - Opus 4.8 xhigh          -> gpt-5.6-terra xhigh
 *   - Fable 5 high/xhigh/max  -> gpt-5.6-sol   at the same effort
 *   - Sonnet 5 xhigh          -> gpt-5.6-luna  xhigh
 *   - BARE ids stay provider-faithful (the real Anthropic models stay reachable)
 *   - suffixed aliases expose ratified Codex + Cloud Code candidates to policy
 *   - bare ids stay provider-faithful; unknown id -> undefined -> router 400
 * Consumers read `describeTargetRoutes()` instead of duplicating a route table.
 */

import { describe, expect, it } from 'vitest';

import {
  createCanonicalTargetCandidatesResolver,
  createCanonicalTargetResolver,
  createStaticTargetResolver,
  defineLaunchAliases,
  describeCanonicalTargetRoutes,
  describeTargetRoutes,
  CANONICAL_TARGET_MAPPINGS,
  CANONICAL_TARGET_ROUTE_MAPPINGS,
  DEFAULT_TARGET_MAPPINGS,
  LAUNCH_ALIAS_TARGET_MAPPINGS,
} from '../src/index.js';

const MERGED = { ...DEFAULT_TARGET_MAPPINGS, ...LAUNCH_ALIAS_TARGET_MAPPINGS };

describe('launch-alias target-map', () => {
  const resolve = createStaticTargetResolver({ mappings: MERGED });

  it('routes the Opus 5 launch aliases to gpt-5.6-terra at the requested effort', () => {
    expect(resolve('claude-opus-5-high')).toEqual({
      providerId: 'openai',
      transportProviderId: 'codex',
      model: 'gpt-5.6-terra',
      effort: 'high',
    });
    expect(resolve('claude-opus-5-xhigh')).toEqual({
      providerId: 'openai',
      transportProviderId: 'codex',
      model: 'gpt-5.6-terra',
      effort: 'xhigh',
    });
  });

  it('routes the Fable 5 launch aliases to gpt-5.6-sol at high/xhigh/max', () => {
    for (const effort of ['high', 'xhigh', 'max'] as const) {
      expect(resolve(`claude-fable-5-${effort}`)).toEqual({
        providerId: 'openai',
        transportProviderId: 'codex',
        model: 'gpt-5.6-sol',
        effort,
      });
    }
  });

  it('routes the owner-ratified Opus 4.8 and Sonnet 5 xhigh aliases', () => {
    expect(resolve('claude-opus-4-8-xhigh')).toEqual({
      providerId: 'openai', transportProviderId: 'codex',
      model: 'gpt-5.6-terra', effort: 'xhigh',
    });
    expect(resolve('claude-sonnet-5-xhigh')).toEqual({
      providerId: 'openai', transportProviderId: 'codex',
      model: 'gpt-5.6-luna', effort: 'xhigh',
    });
  });

  it('keeps the BARE ids provider-faithful (real Anthropic models stay reachable)', () => {
    expect(resolve('claude-opus-5')).toEqual({
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-opus-5',
    });
    expect(resolve('claude-fable-5')).toEqual({
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-fable-5',
    });
    // Superseded as the default Opus, still explicitly selectable.
    expect(resolve('claude-opus-4-8')).toEqual({
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-opus-4-8',
    });
  });

  it('never silently falls back cross-pool: unknown id -> undefined', () => {
    expect(resolve('gemini-3.1-pro')).toBeUndefined();
    expect(resolve('claude-opus-5-ultra')).toBeUndefined();
    expect(resolve('claude-sonnet-5-ultra')).toBeUndefined();
  });
});

describe('defineLaunchAliases', () => {
  it('builds a mappings record from declarative definitions', () => {
    const mappings = defineLaunchAliases([
      { alias: 'x-fast', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
      { alias: 'x-plain', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-luna' },
    ]);
    expect(mappings['x-fast']).toEqual({
      providerId: 'openai',
      transportProviderId: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'high',
    });
    // No effort declared -> no effort key (honor whatever the body carries).
    expect(mappings['x-plain']).toEqual({
      providerId: 'openai',
      transportProviderId: 'codex',
      model: 'gpt-5.6-luna',
    });
  });
});

describe('describeTargetRoutes (discovery)', () => {
  const routes = describeTargetRoutes(MERGED);
  const byId = (id: string) => routes.find((r) => r.requestedId === id);

  it('marks a launch alias as kind=alias with its upstream and effort', () => {
    expect(byId('claude-opus-5-xhigh')).toEqual({
      requestedId: 'claude-opus-5-xhigh',
      providerId: 'openai',
      transportProviderId: 'codex',
      model: 'gpt-5.6-terra',
      effort: 'xhigh',
      kind: 'alias',
    });
  });

  it('marks a provider-faithful id as kind=faithful', () => {
    expect(byId('claude-opus-5')).toEqual({
      requestedId: 'claude-opus-5',
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-opus-5',
      kind: 'faithful',
    });
  });

  it('gives a pure reader the same view with ZERO declaration (canonical entry points)', () => {
    // A consumer that declares nothing must see exactly the canonical set:
    // composing DEFAULT + LAUNCH_ALIAS is itself routing knowledge and must not
    // be re-implemented downstream.
    expect(CANONICAL_TARGET_MAPPINGS).toEqual(MERGED);
    expect(CANONICAL_TARGET_ROUTE_MAPPINGS['claude-opus-5-xhigh']).toEqual([
      MERGED['claude-opus-5-xhigh'],
      {
        providerId: 'gemini',
        transportProviderId: 'cloud-code',
        model: 'gemini-3.7-flash',
        effort: 'xhigh',
      },
    ]);
    expect(describeCanonicalTargetRoutes()).toHaveLength(
      Object.values(CANONICAL_TARGET_ROUTE_MAPPINGS)
        .reduce((total, targets) => total + targets.length, 0),
    );

    const resolve = createCanonicalTargetResolver();
    expect(resolve('claude-opus-5-xhigh')?.model).toBe('gpt-5.6-terra');
    expect(resolve('claude-opus-5')?.model).toBe('claude-opus-5');
    expect(resolve('claude-opus-4-8-xhigh')?.model).toBe('gpt-5.6-terra');
    expect(resolve('claude-sonnet-5-xhigh')?.model).toBe('gpt-5.6-luna');

    const resolveCandidates = createCanonicalTargetCandidatesResolver();
    expect(resolveCandidates('claude-opus-5-xhigh').map(
      (target) => target.transportProviderId,
    )).toEqual(['codex', 'cloud-code']);
  });

  it('describes every servable id exactly once, sorted, with no credential data', () => {
    expect(routes).toHaveLength(Object.keys(MERGED).length);
    expect(routes.map((r) => r.requestedId)).toEqual(
      [...routes.map((r) => r.requestedId)].sort((a, b) => a.localeCompare(b)),
    );
    const serialized = JSON.stringify(routes);
    expect(serialized).not.toMatch(/token|secret|accountId/i);
  });
});
