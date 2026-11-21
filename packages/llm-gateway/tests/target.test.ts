/**
 * Launch-alias routing + route DISCOVERY (single source of truth in the gateway
 * target-map). Owner decision 2026-07-25:
 *   - Every known Claude id resolves to Anthropic first at its declared effort
 *   - Codex and Cloud Code remain the ordered fallback candidates
 *   - unknown id -> undefined -> router 400
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

  it('routes the Opus 5 launch aliases to Anthropic at the requested effort', () => {
    expect(resolve('claude-opus-5-high')).toEqual({
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-opus-5',
      effort: 'high',
    });
    expect(resolve('claude-opus-5-xhigh')).toEqual({
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-opus-5',
      effort: 'xhigh',
    });
  });

  it('routes the Fable 5 and 5.2 launch aliases to Anthropic at high/xhigh/max', () => {
    for (const model of ['claude-fable-5', 'claude-fable-5-2']) {
      for (const effort of ['high', 'xhigh', 'max', 'medium', 'low'] as const) {
        expect(resolve(`${model}-${effort}`)).toEqual({
          providerId: 'anthropic', transportProviderId: 'claude-code', model, effort,
        });
      }
    }
  });

  it('routes RATIFICATION PENDING Opus 4.8 and Sonnet 5 xhigh aliases', () => {
    expect(resolve('claude-opus-4-8-xhigh')).toEqual({
      providerId: 'anthropic', transportProviderId: 'claude-code',
      model: 'claude-opus-4-8', effort: 'xhigh',
    });
    expect(resolve('claude-sonnet-5-xhigh')).toEqual({
      providerId: 'anthropic', transportProviderId: 'claude-code',
      model: 'claude-sonnet-5', effort: 'xhigh',
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
    expect(resolve('claude-fable-5-2')).toEqual({
      providerId: 'anthropic', transportProviderId: 'claude-code',
      model: 'claude-fable-5-2',
    });
    expect(resolve('gemini-4-carbon')).toEqual({
      providerId: 'gemini', transportProviderId: 'cloud-code',
      model: 'gemini-4-carbon',
    });
    expect(resolve('gpt-6-astra')).toEqual({
      providerId: 'openai', transportProviderId: 'codex', model: 'gpt-6-astra',
    });
    expect(resolve('gemini-3.8-flash')).toEqual({
      providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.8-flash',
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
    const resolveCanonical = createCanonicalTargetResolver({ allowEquivalentModels: true });
    const resolveCanonicalCandidates = createCanonicalTargetCandidatesResolver({ allowEquivalentModels: true });
    for (const alias of [
      'claude-fable-5-1', 'claude-fable-5-1-high', 'claude-fable-5-1-xhigh',
      'claude-fable-5-1-max', 'claude-fable-5-1-medium', 'claude-fable-5-1-low',
    ]) {
      expect(resolve(alias), alias).toBeUndefined();
      expect(resolveCanonical(alias), alias).toBeUndefined();
      expect(resolveCanonicalCandidates(alias), alias).toEqual([]);
    }
  });

  it('resolves the Vibe 2.26.1 wire name via the mesh re-export, with no gateway table', () => {
    // The gateway holds no model table: resolution comes from the mesh
    // re-export (`personal-passthrough/target.ts` -> `@sentropic/llm-mesh`).
    // An empty pool returns typed no-route 503; an unknown name stays 404 —
    // the wire name is recognized here, so it must never be a 404.
    const canonical = createCanonicalTargetResolver();
    expect(canonical('mistral-vibe-cli-latest')).toEqual({
      providerId: 'mistral', transportProviderId: 'mistral-vibe',
      model: 'mistral-medium-3.5',
    });
    expect(canonical('mistral-vibe-cli-latest')).toEqual(canonical('mistral-medium-3.5'));
    expect(createCanonicalTargetCandidatesResolver()('mistral-vibe-cli-latest')).toEqual([{
      providerId: 'mistral', transportProviderId: 'mistral-vibe',
      model: 'mistral-medium-3.5',
    }]);
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
      providerId: 'anthropic',
      transportProviderId: 'claude-code',
      model: 'claude-opus-5',
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

  it('exports the shared table and requires explicit policy selection for its fallbacks', () => {
    // A consumer that declares nothing must see exactly the canonical set:
    // composing DEFAULT + LAUNCH_ALIAS is itself routing knowledge and must not
    // be re-implemented downstream.
    expect(CANONICAL_TARGET_MAPPINGS).toEqual(MERGED);
    expect(CANONICAL_TARGET_ROUTE_MAPPINGS['claude-opus-5-xhigh']).toEqual([
      MERGED['claude-opus-5-xhigh'],
      {
        providerId: 'muse',
        transportProviderId: 'muse',
        model: 'muse-spark-1.3-contributor',
        effort: 'xhigh',
      },
      {
        providerId: 'openai',
        transportProviderId: 'codex',
        model: 'gpt-6.1-sol',
        effort: 'max',
      },
      {
        providerId: 'gemini',
        transportProviderId: 'cloud-code',
        model: 'gemini-3.8-flash',
        effort: 'high',
      },
      {
        providerId: 'mistral',
        transportProviderId: 'mistral-vibe',
        model: 'zai-glm-5-3',
        effort: 'max',
      },
    ]);
    expect(CANONICAL_TARGET_ROUTE_MAPPINGS['claude-fable-5-1']).toBeUndefined();
    expect(CANONICAL_TARGET_ROUTE_MAPPINGS['claude-fable-5-1-max']).toBeUndefined();
    // Owner mapping 2026-11-10: Fable 5.2 requests are served by Gemini 4
    // Carbon on the cloud slot. The unmapped max alias keeps the default
    // contributor muse candidate like every other unlisted alias, then the
    // Astra codex slot, Carbon, and the GLM tail.
    expect(CANONICAL_TARGET_ROUTE_MAPPINGS['claude-fable-5-2-max']).toEqual([
      MERGED['claude-fable-5-2-max'],
      {
        providerId: 'muse', transportProviderId: 'muse',
        model: 'muse-spark-1.3-contributor', effort: 'max',
      },
      {
        providerId: 'openai', transportProviderId: 'codex',
        model: 'gpt-6.2-astra', effort: 'max',
      },
      {
        providerId: 'gemini', transportProviderId: 'cloud-code',
        model: 'gemini-4-carbon', effort: 'high',
      },
      {
        providerId: 'mistral', transportProviderId: 'mistral-vibe',
        model: 'zai-glm-5-3', effort: 'max',
      },
    ]);
    expect(describeCanonicalTargetRoutes()).toHaveLength(
      Object.values(CANONICAL_TARGET_ROUTE_MAPPINGS)
        .reduce((total, targets) => total + targets.length, 0),
    );

    const resolve = createCanonicalTargetResolver({ allowEquivalentModels: true });
    expect(resolve('claude-opus-5-xhigh')?.model).toBe('claude-opus-5');
    expect(resolve('claude-opus-5')?.model).toBe('claude-opus-5');
    expect(resolve('claude-opus-4-8-xhigh')?.model).toBe('claude-opus-4-8');
    expect(resolve('claude-sonnet-5-xhigh')?.model).toBe('claude-sonnet-5');

    const resolveCandidates = createCanonicalTargetCandidatesResolver({ allowEquivalentModels: true });
    expect(resolveCandidates('claude-opus-5-xhigh').map(
      (target) => target.transportProviderId,
    )).toEqual(['claude-code', 'muse', 'codex', 'cloud-code', 'mistral-vibe']);
    expect(resolveCandidates('claude-fable-5-1-max')).toEqual([]);
    expect(resolveCandidates('claude-fable-5-2-max')[2]).toMatchObject({
      transportProviderId: 'codex', model: 'gpt-6.2-astra', effort: 'max',
    });
    expect(resolveCandidates('claude-fable-5-2-max')[3]).toMatchObject({
      transportProviderId: 'cloud-code', model: 'gemini-4-carbon', effort: 'high',
    });
  });

  it('exports every remapped Codex and Cloud Code fallback', () => {
    const resolveCandidates = createCanonicalTargetCandidatesResolver({ allowEquivalentModels: true });
    const Muse = (effort: string) => ({
      providerId: 'muse', transportProviderId: 'muse',
      model: 'muse-spark-1.3-contributor', effort,
    });
    const Codex = (model: string, effort?: string) => ({
      providerId: 'openai', transportProviderId: 'codex', model,
      ...(effort ? { effort } : {}),
    });
    const Cloud = () => ({
      providerId: 'gemini', transportProviderId: 'cloud-code',
      model: 'gemini-3.8-flash', effort: 'high',
    });
    // Carbon slot (owner mapping 2026-11-18): the Fable 5.2 family serves
    // GPT-6.2-Astra on the codex slot and Gemini 4 Carbon on the cloud slot.
    const Carbon = (effort = 'high') => ({
      providerId: 'gemini', transportProviderId: 'cloud-code',
      model: 'gemini-4-carbon', effort,
    });
    // GLM 5.3 supplemental fallback (owner decisions 2026-10-07 and
    // 2026-10-08): appended after Codex and Cloud Code for the Opus, Claude
    // 5.5 and Fable 5.2 aliases, at +1 rung on the low/high/max ladder.
    const Glm = (effort = 'max') => ({
      providerId: 'mistral', transportProviderId: 'mistral-vibe',
      model: 'zai-glm-5-3', effort,
    });
    const cases: ReadonlyArray<readonly [string, unknown[]]> = [
      ['claude-fable-5', [Muse('max'), Codex('gpt-6.1-sol', 'high'), Cloud()]],
      ['claude-fable-5-high', [Muse('max'), Codex('gpt-6.1-sol', 'xhigh'), Cloud()]],
      ['claude-fable-5-xhigh', [Muse('max'), Codex('gpt-6.1-sol', 'max'), Cloud()]],
      ['claude-fable-5-max', [Muse('max'), Codex('gpt-6.1-sol', 'max'), Cloud()]],
      ['claude-fable-5-medium', [Muse('high'), Codex('gpt-6.1-sol', 'high'), Cloud()]],
      ['claude-fable-5-low', [Muse('medium'), Codex('gpt-6.1-sol', 'medium'), Cloud()]],
      ['claude-fable-5-2-max', [Muse('max'), Codex('gpt-6.2-astra', 'max'), Carbon('high'), Glm()]],
      ['claude-fable-5-2-medium', [Muse('high'), Codex('gpt-6.2-astra', 'medium'), Carbon('medium'), Glm('high')]],
      ['claude-fable-5-2-low', [Muse('medium'), Codex('gpt-6.2-astra', 'low'), Carbon('low'), Glm('high')]],
      ['claude-opus-5', [Muse('high'), Codex('gpt-6.1-sol', 'high'), Cloud(), Glm()]],
      ['claude-opus-5-high', [Muse('xhigh'), Codex('gpt-6.1-sol', 'xhigh'), Cloud(), Glm()]],
      ['claude-opus-5-xhigh', [Muse('xhigh'), Codex('gpt-6.1-sol', 'max'), Cloud(), Glm()]],
      ['claude-opus-5-max', [Muse('max'), Codex('gpt-6.1-sol', 'max'), Cloud(), Glm()]],
      ['claude-opus-5-medium', [Muse('high'), Codex('gpt-6.1-sol', 'high'), Cloud()]],
      ['claude-opus-5-low', [Muse('medium'), Codex('gpt-6.1-sol', 'medium'), Cloud()]],
      ['claude-opus-4-8', [Muse('high'), Codex('gpt-6.1-sol', 'high'), Cloud(), Glm()]],
      ['claude-opus-4-8-xhigh', [Muse('xhigh'), Codex('gpt-6.1-sol', 'max'), Cloud(), Glm()]],
      ['claude-opus-4-8-max', [Muse('max'), Codex('gpt-6.1-sol', 'max'), Cloud(), Glm()]],
      ['claude-opus-4-8-medium', [Muse('high'), Codex('gpt-6.1-sol', 'high'), Cloud()]],
      ['claude-opus-4-8-low', [Muse('medium'), Codex('gpt-6.1-sol', 'medium'), Cloud()]],
      ['claude-sonnet-5', [Muse('high'), Codex('gpt-6.1-sol', 'high'), Cloud()]],
      ['claude-sonnet-5-xhigh', [Muse('max'), Codex('gpt-6.1-sol', 'max'), Cloud()]],
      ['claude-sonnet-5-medium', [Muse('high'), Codex('gpt-6.1-sol', 'high'), Cloud()]],
      ['claude-sonnet-5-low', [Muse('medium'), Codex('gpt-6.1-sol', 'medium'), Cloud()]],
      ['claude-sonnet-4-6', [Muse('high'), Codex('gpt-6.1-sol', 'high'), Cloud()]],
    ];
    for (const [alias, expected] of cases) {
      expect(resolveCandidates(alias).slice(1)).toEqual(expected);
    }
  });

  it('resolves the Fable 5.2 gateway aliases to Gemini 4 Carbon', () => {
    // Owner mapping 2026-11-18: requests for Fable 5.2 are served by Gemini 4
    // Carbon. The faithful Anthropic target stays first; Carbon is the mapped
    // Cloud Code candidate. The mapped base/high/xhigh aliases emit no muse
    // candidate; max/medium/low keep the default contributor muse candidate.
    const carbonEffort: Readonly<Record<string, string>> = {
      'claude-fable-5-2': 'medium', 'claude-fable-5-2-high': 'high',
      'claude-fable-5-2-xhigh': 'high', 'claude-fable-5-2-max': 'high',
      'claude-fable-5-2-medium': 'medium', 'claude-fable-5-2-low': 'low',
    };
    const resolveCandidates = createCanonicalTargetCandidatesResolver({ allowEquivalentModels: true });
    for (const alias of ['claude-fable-5-2', 'claude-fable-5-2-high', 'claude-fable-5-2-xhigh',
      'claude-fable-5-2-max', 'claude-fable-5-2-medium', 'claude-fable-5-2-low']) {
      const candidates = resolveCandidates(alias);
      expect(candidates.filter((target) => target.transportProviderId === 'cloud-code')).toEqual([{
        providerId: 'gemini', transportProviderId: 'cloud-code',
        model: 'gemini-4-carbon', effort: carbonEffort[alias]!,
      }]);
      expect(candidates.some((target) => target.transportProviderId === 'muse'), alias).toBe(
        ['claude-fable-5-2-max', 'claude-fable-5-2-medium', 'claude-fable-5-2-low'].includes(alias),
      );
    }
  });

  it('exports the 5.5 families with muse first and no faithful target', () => {
    const resolveCandidates = createCanonicalTargetCandidatesResolver({ allowEquivalentModels: true });
    const Muse = (effort: string) => ({
      providerId: 'muse', transportProviderId: 'muse',
      model: 'muse-spark-1.3-contributor', effort,
    });
    const Codex = (model: string, effort?: string) => ({
      providerId: 'openai', transportProviderId: 'codex', model,
      ...(effort ? { effort } : {}),
    });
    const Cloud = () => ({
      providerId: 'gemini', transportProviderId: 'cloud-code',
      model: 'gemini-3.8-flash', effort: 'high',
    });
    // Neon slots (owner mapping 2026-11-18): Wonder Full on the top Opus 5.5
    // rows, Wonder on the mid Opus 5.5 rows, Neon on the cloud slot
    // (base/medium -> medium, high -> high, xhigh/max -> xhigh, low -> low).
    // Hydrogen slots (owner mapping 2026-11-18): every Sonnet 5.5 and Haiku
    // 5.5 row serves Hydrogen at the row effort.
    const Wonder = (effort: string) => ({
      providerId: 'muse', transportProviderId: 'muse',
      model: 'muse-wonder-1.0', effort,
    });
    const WonderFull = (effort: string) => ({
      providerId: 'muse', transportProviderId: 'muse',
      model: 'muse-wonder-full-1.0', effort,
    });
    const Neon = (effort: string) => ({
      providerId: 'gemini', transportProviderId: 'cloud-code',
      model: 'gemini-4-neon', effort,
    });
    const Hydrogen = (effort: string) => ({
      providerId: 'gemini', transportProviderId: 'cloud-code',
      model: 'gemini-4-hydrogen', effort,
    });
    // GLM 5.3 supplemental fallback (owner decision 2026-10-08): last fallback
    // for the Claude 5.5 families at +1 rung on the low/high/max ladder.
    const Glm = (effort: string) => ({
      providerId: 'mistral', transportProviderId: 'mistral-vibe',
      model: 'zai-glm-5-3', effort,
    });
    const cases: ReadonlyArray<readonly [string, unknown[]]> = [
      ['claude-opus-5-5', [Wonder('high'), Codex('gpt-6.2-sol', 'high'), Neon('medium'), Glm('high')]],
      ['claude-opus-5-5-high', [Wonder('xhigh'), Codex('gpt-6.2-sol', 'xhigh'), Neon('high'), Glm('max')]],
      ['claude-opus-5-5-xhigh', [WonderFull('max'), Codex('gpt-6.2-sol', 'max'), Neon('xhigh'), Glm('max')]],
      ['claude-opus-5-5-max', [WonderFull('max'), Codex('gpt-6.2-sol', 'max'), Neon('xhigh'), Glm('max')]],
      ['claude-opus-5-5-medium', [Wonder('high'), Codex('gpt-6.2-sol', 'high'), Neon('medium'), Glm('high')]],
      ['claude-opus-5-5-low', [Muse('medium'), Codex('gpt-6.2-sol', 'medium'), Neon('low'), Glm('high')]],
      ['claude-sonnet-5-5', [Muse('high'), Codex('gpt-6.1-terra', 'medium'), Hydrogen('medium'), Glm('high')]],
      ['claude-sonnet-5-5-high', [Muse('xhigh'), Codex('gpt-6.1-terra', 'high'), Hydrogen('high'), Glm('max')]],
      ['claude-sonnet-5-5-xhigh', [Wonder('max'), Codex('gpt-6.1-terra', 'xhigh'), Hydrogen('xhigh'), Glm('max')]],
      ['claude-sonnet-5-5-max', [WonderFull('max'), Codex('gpt-6.1-terra', 'max'), Hydrogen('xhigh'), Glm('max')]],
      ['claude-sonnet-5-5-medium', [Muse('high'), Codex('gpt-6.1-terra', 'medium'), Hydrogen('medium'), Glm('high')]],
      ['claude-sonnet-5-5-low', [Muse('medium'), Codex('gpt-6.1-terra', 'low'), Hydrogen('low'), Glm('high')]],
      ['claude-haiku-5-5', [Muse('high'), Codex('gpt-6-luna', 'medium'), Hydrogen('medium'), Glm('high')]],
      ['claude-haiku-5-5-high', [Muse('xhigh'), Codex('gpt-6-luna', 'high'), Hydrogen('high'), Glm('max')]],
      ['claude-haiku-5-5-xhigh', [Wonder('max'), Codex('gpt-6-luna', 'xhigh'), Hydrogen('xhigh'), Glm('max')]],
      ['claude-haiku-5-5-max', [WonderFull('max'), Codex('gpt-6-luna', 'max'), Hydrogen('xhigh'), Glm('max')]],
      ['claude-haiku-5-5-medium', [Muse('high'), Codex('gpt-6-luna', 'medium'), Hydrogen('medium'), Glm('high')]],
      ['claude-haiku-5-5-low', [Muse('medium'), Codex('gpt-6-luna', 'low'), Hydrogen('low'), Glm('high')]],
    ];
    for (const [alias, expected] of cases) {
      expect(resolveCandidates(alias)).toEqual(expected);
    }
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

it('keeps default gateway re-export resolution exact', () => {
  expect(createCanonicalTargetCandidatesResolver()('claude-opus-5-5')).toEqual([]);
  expect(createCanonicalTargetResolver()('claude-opus-5')).toMatchObject({ providerId: 'anthropic', model: 'claude-opus-5' });
});
