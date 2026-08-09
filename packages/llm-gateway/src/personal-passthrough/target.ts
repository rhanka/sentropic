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
import {
  CANONICAL_TARGET_MAPPINGS as MESH_CANONICAL_TARGET_MAPPINGS,
  DEFAULT_TARGET_MAPPINGS as MESH_DEFAULT_TARGET_MAPPINGS,
  LAUNCH_ALIAS_TARGET_MAPPINGS as MESH_LAUNCH_ALIAS_TARGET_MAPPINGS,
} from '@sentropic/llm-mesh';

export interface TargetMapping {
  readonly providerId: string;
  readonly transportProviderId: string;
  readonly model: string;
  readonly effort?: string;
}

export interface StaticTargetResolverOptions {
  readonly mappings: Readonly<Record<string, TargetMapping>>;
}

export const createStaticTargetResolver = (
  options: StaticTargetResolverOptions,
): TargetResolver => (model: string): ResolvedTarget | undefined => {
  const mapping = options.mappings[model];
  return mapping ? {
    providerId: mapping.providerId,
    transportProviderId: mapping.transportProviderId,
    model: mapping.model,
    ...(mapping.effort ? { effort: mapping.effort } : {}),
  } : undefined;
};

export const DEFAULT_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> =
  MESH_DEFAULT_TARGET_MAPPINGS;

export interface LaunchAliasDefinition {
  readonly alias: string;
  readonly providerId: string;
  readonly transportProviderId: string;
  readonly model: string;
  readonly effort?: string;
}

export const defineLaunchAliases = (
  definitions: readonly LaunchAliasDefinition[],
): Readonly<Record<string, TargetMapping>> => Object.fromEntries(
  definitions.map(({ alias, ...target }) => [alias, target]),
);

export const LAUNCH_ALIAS_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> =
  MESH_LAUNCH_ALIAS_TARGET_MAPPINGS;

export const CANONICAL_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> =
  MESH_CANONICAL_TARGET_MAPPINGS;

export interface TargetRouteDescription {
  readonly requestedId: string;
  readonly providerId: string;
  readonly transportProviderId: string;
  readonly model: string;
  readonly effort?: string;
  readonly kind: 'faithful' | 'alias';
}

export const describeTargetRoutes = (
  mappings: Readonly<Record<string, TargetMapping>>,
): readonly TargetRouteDescription[] => Object.entries(mappings)
  .map(([requestedId, mapping]) => ({
    requestedId,
    providerId: mapping.providerId,
    transportProviderId: mapping.transportProviderId,
    model: mapping.model,
    ...(mapping.effort ? { effort: mapping.effort } : {}),
    kind: requestedId === mapping.model ? 'faithful' as const : 'alias' as const,
  }))
  .sort((left, right) => left.requestedId.localeCompare(right.requestedId));

export const describeCanonicalTargetRoutes = (): readonly TargetRouteDescription[] =>
  describeTargetRoutes(CANONICAL_TARGET_MAPPINGS);

export const createCanonicalTargetResolver = (): TargetResolver =>
  createStaticTargetResolver({ mappings: CANONICAL_TARGET_MAPPINGS });
