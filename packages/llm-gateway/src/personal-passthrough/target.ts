/**
 * v0 model -> provider/transport resolution (spec §2 "parse provider/model").
 *
 * llm-mesh has NO bare-model -> provider lookup (it needs an explicit provider);
 * the catalog-driven resolver lives in the app. For v0 personal-passthrough the
 * gateway uses an explicit, auditable map: a model id resolves to its TARGET
 * provider (anthropic/openai/...) and the TRANSPORT provider whose pooled
 * account executes it (claude-code/codex/...). Lot 3+ replaces this with the
 * catalog/pool snapshot. An unknown model -> `undefined` (router maps to 400).
 */

import type { ResolvedTarget, TargetResolver } from '../flow.js';

export interface TargetMapping {
  /** Target provider family (e.g. `anthropic`, `openai`). */
  readonly providerId: string;
  /** Transport provider whose pooled account executes it (e.g. `claude-code`). */
  readonly transportProviderId: string;
  /** Canonical runtime model id (alias-free — display aliases never key a lease). */
  readonly model: string;
  /** Optional reasoning effort the alias implies (e.g. a `*-xhigh` launch alias). */
  readonly effort?: string;
}

export interface StaticTargetResolverOptions {
  /** Map of accepted model id -> target. Both exact ids and aliases may be keyed. */
  readonly mappings: Readonly<Record<string, TargetMapping>>;
}

/**
 * Build a `TargetResolver` from an explicit model map. Resolution is exact-match
 * on the body `model` string; the resolved `model` is the canonical runtime id
 * (so the lease keys on the canonical id, not a display alias — prior sticky
 * spec D3).
 */
export const createStaticTargetResolver = (
  options: StaticTargetResolverOptions,
): TargetResolver => {
  return (model: string): ResolvedTarget | undefined => {
    const mapping = options.mappings[model];
    if (!mapping) {
      return undefined;
    }
    return {
      providerId: mapping.providerId,
      transportProviderId: mapping.transportProviderId,
      model: mapping.model,
      ...(mapping.effort ? { effort: mapping.effort } : {}),
    };
  };
};

/**
 * A minimal default map for v0 personal-passthrough over Claude-Code / Codex
 * pooled accounts. Uses the current llm-mesh catalog ids. Hosts override this
 * with their enrolled pool's models.
 */
export const DEFAULT_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> = {
  'claude-sonnet-5': {
    providerId: 'anthropic',
    transportProviderId: 'claude-code',
    model: 'claude-sonnet-5',
  },
  'claude-opus-5': {
    providerId: 'anthropic',
    transportProviderId: 'claude-code',
    model: 'claude-opus-5',
  },
  'claude-opus-4-8': {
    providerId: 'anthropic',
    transportProviderId: 'claude-code',
    model: 'claude-opus-4-8',
  },
  'claude-fable-5': {
    providerId: 'anthropic',
    transportProviderId: 'claude-code',
    model: 'claude-fable-5',
  },
  'gpt-5.6-luna': {
    providerId: 'openai',
    transportProviderId: 'codex',
    model: 'gpt-5.6-luna',
  },
  'gpt-5.6-sol': {
    providerId: 'openai',
    transportProviderId: 'codex',
    model: 'gpt-5.6-sol',
  },
  'gpt-5.6-terra': {
    providerId: 'openai',
    transportProviderId: 'codex',
    model: 'gpt-5.6-terra',
  },
};

/**
 * A launch alias: a DISPLAY name (what a skill/CLI asks for) served by another
 * pooled upstream at a chosen effort. Declarative on purpose — hosts DECLARE
 * their aliases instead of every consumer hardcoding a private routing table.
 */
export interface LaunchAliasDefinition {
  /** The requested display id, e.g. `claude-opus-5-xhigh`. */
  readonly alias: string;
  /** Provider family that actually serves it, e.g. `openai`. */
  readonly providerId: string;
  /** Transport whose pooled account executes it, e.g. `codex`. */
  readonly transportProviderId: string;
  /** Canonical upstream runtime model id, e.g. `gpt-5.6-terra`. */
  readonly model: string;
  /** Reasoning effort the alias implies. */
  readonly effort?: string;
}

/**
 * Build a mappings record from declarative alias definitions. Use this to
 * DECLARE a host's launch aliases rather than hand-rolling a routing table:
 *
 *   createStaticTargetResolver({
 *     mappings: {
 *       ...DEFAULT_TARGET_MAPPINGS,
 *       ...defineLaunchAliases([{ alias: 'x-fast', providerId: 'openai',
 *          transportProviderId: 'codex', model: 'gpt-5.6-sol', effort: 'high' }]),
 *     },
 *   })
 */
export const defineLaunchAliases = (
  definitions: readonly LaunchAliasDefinition[],
): Readonly<Record<string, TargetMapping>> => {
  const out: Record<string, TargetMapping> = {};
  for (const d of definitions) {
    out[d.alias] = {
      providerId: d.providerId,
      transportProviderId: d.transportProviderId,
      model: d.model,
      ...(d.effort ? { effort: d.effort } : {}),
    };
  }
  return out;
};

/**
 * The owner-ratified launch-alias preset (2026-07-25). SUFFIXED aliases only —
 * the BARE ids (`claude-opus-5`, `claude-fable-5`) stay provider-faithful in
 * `DEFAULT_TARGET_MAPPINGS`, so the real Anthropic models remain reachable under
 * their own names. This is a routing POLICY, NOT a provider identity, which is
 * why it lives here and NOT in the llm-mesh catalog.
 *
 *   Opus 5   high/xhigh -> gpt-5.6-terra (same effort)
 *   Fable 5  high/xhigh/max -> gpt-5.6-sol (same effort)
 *
 * Merge it OVER `DEFAULT_TARGET_MAPPINGS`. No silent cross-pool fallback: any id
 * absent from the merged map resolves to `undefined` (router -> provider-shaped
 * 400). Consumers MUST NOT re-implement this in a duplicated model-route
 * catalog — read it via `describeTargetRoutes()` instead.
 */
export const LAUNCH_ALIAS_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> =
  defineLaunchAliases([
    { alias: 'claude-opus-5-high', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra', effort: 'high' },
    { alias: 'claude-opus-5-xhigh', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' },
    { alias: 'claude-fable-5-high', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
    { alias: 'claude-fable-5-xhigh', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
    { alias: 'claude-fable-5-max', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
  ]);

/** One discoverable route: what a caller may ask for, and what actually serves it. */
export interface TargetRouteDescription {
  /** The id a caller puts in the request body `model`. */
  readonly requestedId: string;
  /** Provider family that serves it. */
  readonly providerId: string;
  /** Transport whose pooled account executes it. */
  readonly transportProviderId: string;
  /** Canonical upstream runtime model id. */
  readonly model: string;
  /** Effort the route implies, when the mapping pins one. */
  readonly effort?: string;
  /**
   * `faithful` = the requested id IS the upstream model (provider identity).
   * `alias`    = a display name routed to a different upstream (routing policy).
   */
  readonly kind: 'faithful' | 'alias';
}

/**
 * DISCOVERY API — describe every servable route of a mappings record, so skills,
 * CLIs and downstream gateways can READ the routing instead of duplicating it.
 * Pure and side-effect free; carries no account/credential data.
 */
export const describeTargetRoutes = (
  mappings: Readonly<Record<string, TargetMapping>>,
): readonly TargetRouteDescription[] =>
  Object.entries(mappings)
    .map(([requestedId, m]) => ({
      requestedId,
      providerId: m.providerId,
      transportProviderId: m.transportProviderId,
      model: m.model,
      ...(m.effort ? { effort: m.effort } : {}),
      kind: (requestedId === m.model ? 'faithful' : 'alias') as 'faithful' | 'alias',
    }))
    .sort((a, b) => a.requestedId.localeCompare(b.requestedId));
