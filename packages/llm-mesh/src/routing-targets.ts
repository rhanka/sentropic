export interface TargetMapping {
  readonly providerId: string;
  readonly transportProviderId: string;
  readonly model: string;
  readonly effort?: string;
}

export interface LaunchAliasDefinition extends TargetMapping {
  readonly alias: string;
}

export interface TargetRouteDescription extends TargetMapping {
  readonly requestedId: string;
  readonly kind: 'faithful' | 'alias';
}

export type ModelTargetResolver = (model: string) => TargetMapping | undefined;
export type ModelTargetCandidatesResolver = (
  model: string,
) => readonly TargetMapping[];

export const defineLaunchAliases = (
  definitions: readonly LaunchAliasDefinition[],
): Readonly<Record<string, TargetMapping>> => Object.fromEntries(
  definitions.map(({ alias, ...target }) => [alias, target]),
);

export const DEFAULT_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> = {
  'claude-sonnet-5': {
    providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-sonnet-5',
  },
  'claude-opus-5': {
    providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-opus-5',
  },
  'claude-opus-4-8': {
    providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-opus-4-8',
  },
  'claude-fable-5': {
    providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-fable-5',
  },
  'gpt-5.6-luna': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-luna',
  },
  'gpt-5.6-sol': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-sol',
  },
  'gpt-5.6-terra': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra',
  },
};

export const LAUNCH_ALIAS_TARGET_MAPPINGS = defineLaunchAliases([
  { alias: 'claude-opus-5-high', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra', effort: 'high' },
  { alias: 'claude-opus-5-xhigh', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' },
  { alias: 'claude-opus-4-8-xhigh', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' },
  { alias: 'claude-fable-5-high', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
  { alias: 'claude-fable-5-xhigh', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
  { alias: 'claude-fable-5-max', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
  { alias: 'claude-sonnet-5-xhigh', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-luna', effort: 'xhigh' },
]);

const CLOUD_CODE_LAUNCH_TARGET: TargetMapping = {
  providerId: 'gemini',
  transportProviderId: 'cloud-code',
  model: 'gemini-3.1-flash-lite',
};

/**
 * A launch alias is an explicit user-facing routing contract, not benchmark
 * equivalence evidence. Keep the historical Codex target first for backwards
 * compatibility while exposing the owner-ratified Cloud Code target to route
 * policy ordering and bounded pre-byte fallback.
 */
export const LAUNCH_ALIAS_ROUTE_MAPPINGS: Readonly<
  Record<string, readonly TargetMapping[]>
> = Object.fromEntries(Object.entries(LAUNCH_ALIAS_TARGET_MAPPINGS).map(
  ([alias, primary]) => [alias, [primary, CLOUD_CODE_LAUNCH_TARGET]],
));

export const CANONICAL_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> = {
  ...DEFAULT_TARGET_MAPPINGS,
  ...LAUNCH_ALIAS_TARGET_MAPPINGS,
};

export const CANONICAL_TARGET_ROUTE_MAPPINGS: Readonly<
  Record<string, readonly TargetMapping[]>
> = {
  ...Object.fromEntries(Object.entries(DEFAULT_TARGET_MAPPINGS).map(
    ([requestedId, target]) => [requestedId, [target]],
  )),
  ...LAUNCH_ALIAS_ROUTE_MAPPINGS,
};

export const createStaticTargetResolver = (options: {
  readonly mappings: Readonly<Record<string, TargetMapping>>;
}): ModelTargetResolver => (model) => options.mappings[model];

export const createCanonicalTargetResolver = (): ModelTargetResolver =>
  createStaticTargetResolver({ mappings: CANONICAL_TARGET_MAPPINGS });

export const createCanonicalTargetCandidatesResolver = (
): ModelTargetCandidatesResolver => (model) =>
  CANONICAL_TARGET_ROUTE_MAPPINGS[model] ?? [];

export const describeTargetRoutes = (
  mappings: Readonly<Record<string, TargetMapping>>,
): readonly TargetRouteDescription[] => Object.entries(mappings)
  .map(([requestedId, target]) => ({
    requestedId,
    ...target,
    kind: requestedId === target.model ? 'faithful' as const : 'alias' as const,
  }))
  .sort((left, right) => left.requestedId.localeCompare(right.requestedId));

export const describeCanonicalTargetRoutes = (): readonly TargetRouteDescription[] =>
  Object.entries(CANONICAL_TARGET_ROUTE_MAPPINGS)
    .flatMap(([requestedId, targets]) => targets.map((target) => ({
      requestedId,
      ...target,
      kind: requestedId === target.model ? 'faithful' as const : 'alias' as const,
    })))
    .sort((left, right) => left.requestedId.localeCompare(right.requestedId)
      || left.transportProviderId.localeCompare(right.transportProviderId));
