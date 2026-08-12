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

const STANDARD_CODEX_ROUTE_MAPPINGS = defineLaunchAliases([
  { alias: 'claude-opus-5', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra' },
  { alias: 'claude-opus-4-8', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra' },
  { alias: 'claude-sonnet-5', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-luna' },
  { alias: 'claude-sonnet-4-6', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-luna' },
  { alias: 'claude-fable-5', providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-sol' },
]);

const CLOUD_CODE_MODEL_BY_REQUESTED_ID: Readonly<Record<string, string>> = {
  'claude-opus-5': 'claude-opus-4-6-thinking',
  'claude-opus-5-high': 'claude-opus-4-6-thinking',
  'claude-opus-5-xhigh': 'claude-opus-4-6-thinking',
  'claude-opus-4-8': 'claude-opus-4-6-thinking',
  'claude-opus-4-8-xhigh': 'claude-opus-4-6-thinking',
  'claude-sonnet-5': 'gemini-3.6-flash',
  'claude-sonnet-5-xhigh': 'gemini-3.6-flash',
  'claude-sonnet-4-6': 'gemini-3.6-flash',
  'claude-fable-5': 'gemini-3.1-pro',
  'claude-fable-5-high': 'gemini-3.1-pro',
  'claude-fable-5-xhigh': 'gemini-3.1-pro',
  'claude-fable-5-max': 'gemini-3.1-pro',
};

const cloudCodeLaunchTarget = (
  requestedId: string,
  primary: TargetMapping,
): TargetMapping => ({
  providerId: 'gemini',
  transportProviderId: 'cloud-code',
  model: CLOUD_CODE_MODEL_BY_REQUESTED_ID[requestedId]!,
  ...(primary.effort ? { effort: primary.effort } : {}),
});

const CLOUD_CODE_CAPABILITY_SOURCE_BY_MODEL: Readonly<Record<string, TargetMapping>> = {
  'claude-opus-4-6-thinking': {
    providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-opus-4-8',
  },
  'gemini-3.6-flash': {
    providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.5-flash',
  },
  'gemini-3.1-pro': {
    providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.5-flash',
  },
};

export const resolveTargetCapabilitySource = (target: TargetMapping): TargetMapping =>
  target.transportProviderId === 'cloud-code'
    ? CLOUD_CODE_CAPABILITY_SOURCE_BY_MODEL[target.model] ?? target
    : target;

/**
 * A launch alias is an explicit user-facing routing contract, not benchmark
 * equivalence evidence. Keep the historical Codex target first for backwards
 * compatibility while exposing the owner-ratified Cloud Code target to route
 * policy ordering and bounded pre-byte fallback.
 */
export const LAUNCH_ALIAS_ROUTE_MAPPINGS: Readonly<
  Record<string, readonly TargetMapping[]>
> = Object.fromEntries(Object.entries({
  ...STANDARD_CODEX_ROUTE_MAPPINGS,
  ...LAUNCH_ALIAS_TARGET_MAPPINGS,
}).map(
  ([alias, primary]) => [alias, [primary, cloudCodeLaunchTarget(alias, primary)]],
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
    ([requestedId, targets]) => [
      requestedId,
      DEFAULT_TARGET_MAPPINGS[requestedId]
        ? [DEFAULT_TARGET_MAPPINGS[requestedId], ...targets]
        : targets,
    ],
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
