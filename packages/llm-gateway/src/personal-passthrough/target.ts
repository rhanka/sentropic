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
    };
  };
};

/**
 * A minimal default map for v0 personal-passthrough over Claude-Code / Codex
 * pooled accounts. Uses the current llm-mesh catalog ids. Hosts override this
 * with their enrolled pool's models.
 */
export const DEFAULT_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> = {
  'claude-sonnet-4-6': {
    providerId: 'anthropic',
    transportProviderId: 'claude-code',
    model: 'claude-sonnet-4-6',
  },
  'claude-opus-4-7': {
    providerId: 'anthropic',
    transportProviderId: 'claude-code',
    model: 'claude-opus-4-7',
  },
  'gpt-5.5': {
    providerId: 'openai',
    transportProviderId: 'codex',
    model: 'gpt-5.5',
  },
};
