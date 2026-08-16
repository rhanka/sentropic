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
  'gemini-3.7-flash': {
    providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.7-flash',
  },
  'gpt-5.6-terra': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra',
  },
};

type StandardRouteDefinition = readonly [string, string, string, string?];
const STANDARD_ROUTE_DEFINITIONS: readonly StandardRouteDefinition[] = [
  ['claude-opus-5', 'gpt-5.6-terra', 'claude-opus-4-6-thinking'],
  ['claude-opus-5-high', 'gpt-5.6-terra', 'claude-opus-4-6-thinking', 'high'],
  ['claude-opus-5-xhigh', 'gpt-5.6-terra', 'claude-opus-4-6-thinking', 'xhigh'],
  ['claude-opus-4-8', 'gpt-5.6-terra', 'claude-opus-4-6-thinking'],
  ['claude-opus-4-8-xhigh', 'gpt-5.6-terra', 'claude-opus-4-6-thinking', 'xhigh'],
  ['claude-sonnet-5', 'gpt-5.6-luna', 'gemini-3.7-flash'],
  ['claude-sonnet-5-xhigh', 'gpt-5.6-luna', 'gemini-3.7-flash', 'xhigh'],
  ['claude-sonnet-4-6', 'gpt-5.6-luna', 'gemini-3.7-flash'],
  ['claude-fable-5', 'gpt-5.6-sol', 'gemini-3.1-pro'],
  ['claude-fable-5-high', 'gpt-5.6-sol', 'gemini-3.1-pro', 'high'],
  ['claude-fable-5-xhigh', 'gpt-5.6-sol', 'gemini-3.1-pro', 'xhigh'],
  ['claude-fable-5-max', 'gpt-5.6-sol', 'gemini-3.1-pro', 'max'],
];
const codexTarget = (model: string, effort?: string): TargetMapping => ({
  providerId: 'openai', transportProviderId: 'codex', model,
  ...(effort ? { effort } : {}),
});

export const LAUNCH_ALIAS_TARGET_MAPPINGS = Object.fromEntries(
  STANDARD_ROUTE_DEFINITIONS.filter(([, , , effort]) => effort)
    .map(([requestedId, model, , effort]) => [requestedId, codexTarget(model, effort)]),
);

const CLOUD_CODE_CAPABILITY_SOURCE_BY_MODEL: Readonly<
  Record<string, readonly [string, string]>
> = {
  'claude-opus-4-6-thinking': ['anthropic', 'claude-opus-4-8'],
  'gemini-3.6-flash': ['gemini', 'gemini-3.7-flash'],
  'gemini-3.1-pro': ['gemini', 'gemini-3.5-flash'],
};

export const resolveTargetCapabilitySource = (target: TargetMapping): TargetMapping => {
  const source = target.transportProviderId === 'cloud-code'
    ? CLOUD_CODE_CAPABILITY_SOURCE_BY_MODEL[target.model] : undefined;
  return source ? { ...target, providerId: source[0], model: source[1] } : target;
};

/**
 * A launch alias is an explicit user-facing routing contract, not benchmark
 * equivalence evidence. Keep the historical Codex target first for backwards
 * compatibility while exposing the owner-ratified Cloud Code target to route
 * policy ordering and bounded pre-byte fallback.
 */
export const LAUNCH_ALIAS_ROUTE_MAPPINGS: Readonly<
  Record<string, readonly TargetMapping[]>
> = Object.fromEntries(STANDARD_ROUTE_DEFINITIONS.map(
  ([requestedId, codexModel, cloudModel, effort]) => [requestedId, [
    codexTarget(codexModel, effort),
    {
      providerId: 'gemini', transportProviderId: 'cloud-code', model: cloudModel,
      ...(effort ? { effort } : {}),
    },
  ]],
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
  ...Object.fromEntries(Object.entries(LAUNCH_ALIAS_ROUTE_MAPPINGS).map(
    ([requestedId, targets]) => [requestedId, [
      ...(DEFAULT_TARGET_MAPPINGS[requestedId] ? [DEFAULT_TARGET_MAPPINGS[requestedId]!] : []),
      ...targets,
    ]],
  )),
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
