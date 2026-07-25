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
  'claude-opus-4-8': {
    providerId: 'anthropic',
    transportProviderId: 'claude-code',
    model: 'claude-opus-4-8',
  },
  'gpt-5.6-luna': {
    providerId: 'openai',
    transportProviderId: 'codex',
    model: 'gpt-5.6-luna',
  },
  'gpt-5.6-terra': {
    providerId: 'openai',
    transportProviderId: 'codex',
    model: 'gpt-5.6-terra',
    effort: 'xhigh',
  },
};

/**
 * Launch-alias target-map — the single source of truth for Claude-compat LAUNCH
 * aliases that the owner routes to a different pooled upstream. This is a routing
 * POLICY (a launch name served by another provider's model), NOT a provider-
 * faithful identity, so it lives here and NOT in the llm-mesh catalog (where
 * `claude-opus-4-8` stays the real Anthropic model). Merge it OVER
 * `DEFAULT_TARGET_MAPPINGS` to enable the preset:
 *
 *   createStaticTargetResolver({
 *     mappings: { ...DEFAULT_TARGET_MAPPINGS, ...LAUNCH_ALIAS_TARGET_MAPPINGS },
 *   })
 *
 * No silent cross-pool fallback: any id absent from the merged map resolves to
 * `undefined` (router -> provider-shaped 400). Consumers MUST NOT re-implement
 * this routing in a duplicated model-route catalog.
 */
export const LAUNCH_ALIAS_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> = {
  'claude-opus-4-8-xhigh': {
    providerId: 'openai',
    transportProviderId: 'codex',
    model: 'gpt-5.6-terra',
    effort: 'xhigh',
  },
  'claude-opus-4-8': {
    providerId: 'openai',
    transportProviderId: 'codex',
    model: 'gpt-5.6-terra',
    effort: 'xhigh',
  },
};
