import { modelProfiles } from './catalog.js';

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

export const MUSE_CONTRIBUTOR_MODEL = 'muse-spark-1.3-contributor';

export const DEFAULT_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> = {
  'muse-spark-1.3': {
    providerId: 'muse', transportProviderId: 'muse', model: 'muse-spark-1.3',
  },
  'muse-spark-1.3-contributor': {
    providerId: 'muse', transportProviderId: 'muse', model: MUSE_CONTRIBUTOR_MODEL,
  },
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
  'claude-fable-5-1': {
    providerId: 'anthropic', transportProviderId: 'claude-code', model: 'claude-fable-5-1',
  },
  'gpt-5.6-luna': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-luna',
  },
  'gpt-5.6-sol': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-sol',
  },
  'gpt-6-astra': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-6-astra',
  },
  'gemini-3.7-flash': {
    providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.7-flash',
  },
  'gemini-3.8-flash': {
    providerId: 'gemini', transportProviderId: 'cloud-code', model: 'gemini-3.8-flash',
  },
  'gpt-5.6-terra': {
    providerId: 'openai', transportProviderId: 'codex', model: 'gpt-5.6-terra',
  },
};

export interface StandardRouteDefinition {
  readonly requestedId: string;
  readonly codexModel: string;
  readonly cloudModel: string;
  readonly effort?: string;
  /** Codex-candidate effort override; defaults to the route effort. */
  readonly codexEffort?: string;
  /** Cloud-candidate effort override; defaults to the route effort. */
  readonly cloudEffort?: string;
}

/**
 * Muse insertion effort per launch alias (BR75-D1). Aliases absent from this
 * map get no muse candidate. Tier default is contributor (BR75-Q3).
 */
export const MUSE_ROUTE_EFFORT: Readonly<Record<string, string>> = {
  'claude-fable-5': 'max',
  'claude-fable-5-high': 'max',
  'claude-fable-5-xhigh': 'max',
  'claude-fable-5-max': 'max',
  'claude-fable-5-1': 'max',
  'claude-fable-5-1-high': 'max',
  'claude-fable-5-1-xhigh': 'max',
  'claude-fable-5-1-max': 'max',
  'claude-opus-5-high': 'xhigh',
  'claude-opus-5-xhigh': 'xhigh',
  'claude-opus-5-max': 'max',
  'claude-opus-4-8-xhigh': 'xhigh',
  'claude-opus-4-8-max': 'max',
};

/**
 * Integrator-configurable muse position (BR75-Q2). Default `after-claude`.
 * `claude-last` orders codex, muse, cloud, then faithful claude (S6).
 */
export type MusePosition = 'off' | 'after-claude' | 'first' | 'claude-last';

export const DEFAULT_MUSE_POSITION: MusePosition = 'after-claude';

export const STANDARD_ROUTE_DEFINITIONS: readonly StandardRouteDefinition[] = [
  { requestedId: 'claude-opus-5', codexModel: 'gpt-5.6-sol', cloudModel: 'gemini-3.8-flash', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-high', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', effort: 'high', codexEffort: 'medium', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-xhigh', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', effort: 'xhigh', codexEffort: 'medium', cloudEffort: 'high' },
  { requestedId: 'claude-opus-5-max', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', effort: 'max', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-opus-4-8', codexModel: 'gpt-5.6-terra', cloudModel: 'gemini-3.8-flash', cloudEffort: 'high' },
  { requestedId: 'claude-opus-4-8-xhigh', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', effort: 'xhigh', codexEffort: 'medium', cloudEffort: 'high' },
  { requestedId: 'claude-opus-4-8-max', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', effort: 'max', codexEffort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-5', codexModel: 'gpt-5.6-luna', cloudModel: 'gemini-3.8-flash', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-5-xhigh', codexModel: 'gpt-5.6-luna', cloudModel: 'gemini-3.8-flash', effort: 'xhigh', cloudEffort: 'high' },
  { requestedId: 'claude-sonnet-4-6', codexModel: 'gpt-5.6-luna', cloudModel: 'gemini-3.8-flash', cloudEffort: 'high' },
  // GA switch applied: Fable 5 and 5.1 now use GPT-6 Astra.
  { requestedId: 'claude-fable-5', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-high', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', effort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-xhigh', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', effort: 'xhigh', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-max', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', effort: 'max', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-1', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-1-high', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', effort: 'high', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-1-xhigh', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', effort: 'xhigh', cloudEffort: 'high' },
  { requestedId: 'claude-fable-5-1-max', codexModel: 'gpt-6-astra', cloudModel: 'gemini-3.8-flash', effort: 'max', cloudEffort: 'high' },
];

const ANTHROPIC_FAITHFUL_TRANSPORT_PROVIDERS: readonly string[] = ['claude-code'];

const CLAUDE_SUCCESSION_MAP: Readonly<Record<string, string>> = {
  // RATIFICATION PENDING (owner decision not yet traced; see PR body):
  // model succession from api/src/services/model-selection-legacy.ts:
  // claude-sonnet-4-6 -> claude-sonnet-5
  'claude-sonnet-4-6': 'claude-sonnet-5',
};

const isFaithfulAnthropicTransport = (transportProviderId: string | undefined): boolean => (
  transportProviderId
    ? ANTHROPIC_FAITHFUL_TRANSPORT_PROVIDERS.includes(transportProviderId)
    : false
);

const codexTarget = (model: string, effort?: string): TargetMapping => ({
  providerId: 'openai', transportProviderId: 'codex', model,
  ...(effort ? { effort } : {}),
});

const claudeTarget = (model: string, effort?: string): TargetMapping => ({
  providerId: 'anthropic', transportProviderId: 'claude-code', model,
  ...(effort ? { effort } : {}),
});

const faithfulClaudeModel = (requestedId: string): string =>
  requestedId.replace(/-(?:high|xhigh|max)$/, '');

const CLOUD_CODE_CAPABILITY_SOURCE_BY_MODEL: Readonly<
  Record<string, readonly [string, string]>
> = {
  'claude-opus-4-6-thinking': ['anthropic', 'claude-opus-4-8'],
  'gemini-3.6-flash': ['gemini', 'gemini-3.7-flash'],
  'gemini-3.1-pro': ['gemini', 'gemini-3.7-flash'],
};

export const resolveTargetCapabilitySource = (target: TargetMapping): TargetMapping => {
  const source = target.transportProviderId === 'cloud-code'
    ? CLOUD_CODE_CAPABILITY_SOURCE_BY_MODEL[target.model] : undefined;
  return source ? { ...target, providerId: source[0], model: source[1] } : target;
};

const hasModelProfile = (target: Pick<TargetMapping, 'providerId' | 'model'>): boolean =>
  modelProfiles.some(
    (profile) =>
      profile.providerId === target.providerId && profile.modelId === target.model,
  );

const hasFaithfulAnthropicProfile = (target: {
  readonly providerId: string;
  readonly transportProviderId?: string;
  readonly model: string;
}): boolean =>
  target.providerId === 'anthropic'
  && isFaithfulAnthropicTransport(target.transportProviderId)
  && hasModelProfile(target);

const resolveFaithfulAnthropicTarget = (
  requestedId: string,
  effort?: string,
): TargetMapping | undefined => {
  let faithfulModel = faithfulClaudeModel(requestedId);
  const seen = new Set<string>();

  while (!seen.has(faithfulModel)) {
    seen.add(faithfulModel);
    const candidate = claudeTarget(faithfulModel, effort);
    if (hasFaithfulAnthropicProfile(candidate)) return candidate;
    const successor = CLAUDE_SUCCESSION_MAP[faithfulModel];
    if (!successor) break;
    faithfulModel = successor;
  }
  return undefined;
};

const firstTargetThatResolvesProfile = (
  targets: readonly TargetMapping[],
): TargetMapping =>
  targets.find((target) => hasModelProfile(target)) ?? targets[0]!;

const museTarget = (requestedId: string): TargetMapping | undefined => {
  const effort = MUSE_ROUTE_EFFORT[requestedId];
  if (!effort) return undefined;
  const candidate: TargetMapping = {
    providerId: 'muse', transportProviderId: 'muse', model: MUSE_CONTRIBUTOR_MODEL, effort,
  };
  return hasModelProfile(candidate) ? candidate : undefined;
};

/**
 * A launch alias is an explicit user-facing routing contract, not benchmark
 * equivalence evidence. A known Claude id must reach its Anthropic target
 * before the permitted Muse, Codex and Cloud Code fallbacks.
 */
const launchAliasTargetsFor = (
  definition: StandardRouteDefinition,
  musePosition: MusePosition = DEFAULT_MUSE_POSITION,
): readonly TargetMapping[] => {
  const { requestedId, codexModel, cloudModel, effort } = definition;
  const faithfulTarget = resolveFaithfulAnthropicTarget(requestedId, effort);
  const codexCandidate = codexTarget(
    codexModel, definition.codexEffort ?? effort,
  );
  const cloudEffort = definition.cloudEffort ?? effort;
  const cloudCandidate: TargetMapping = {
    providerId: 'gemini', transportProviderId: 'cloud-code', model: cloudModel,
    ...(cloudEffort ? { effort: cloudEffort } : {}),
  };
  const museCandidate = musePosition === 'off' ? undefined : museTarget(requestedId);

  if (musePosition === 'first' && museCandidate) {
    return [
      museCandidate,
      ...(faithfulTarget ? [faithfulTarget] : []),
      codexCandidate,
      cloudCandidate,
    ];
  }
  if (musePosition === 'claude-last') {
    return [
      codexCandidate,
      ...(museCandidate ? [museCandidate] : []),
      cloudCandidate,
      ...(faithfulTarget ? [faithfulTarget] : []),
    ];
  }
  return [
    ...(faithfulTarget ? [faithfulTarget] : []),
    ...(museCandidate ? [museCandidate] : []),
    codexCandidate,
    cloudCandidate,
  ];
};

const buildLaunchAliasRouteMappings = (
  musePosition: MusePosition = DEFAULT_MUSE_POSITION,
): Readonly<Record<string, readonly TargetMapping[]>> => Object.fromEntries(
  STANDARD_ROUTE_DEFINITIONS.map((definition) => [
    definition.requestedId,
    launchAliasTargetsFor(definition, musePosition),
  ]),
);

export const LAUNCH_ALIAS_ROUTE_MAPPINGS: Readonly<
  Record<string, readonly TargetMapping[]>
> = buildLaunchAliasRouteMappings();

const launchAliasRouteMappingsByPosition = new Map<MusePosition, Readonly<
  Record<string, readonly TargetMapping[]>
>>([[DEFAULT_MUSE_POSITION, LAUNCH_ALIAS_ROUTE_MAPPINGS]]);

const launchAliasRouteMappingsFor = (
  musePosition: MusePosition = DEFAULT_MUSE_POSITION,
): Readonly<Record<string, readonly TargetMapping[]>> => {
  const cached = launchAliasRouteMappingsByPosition.get(musePosition);
  if (cached) return cached;
  const built = buildLaunchAliasRouteMappings(musePosition);
  launchAliasRouteMappingsByPosition.set(musePosition, built);
  return built;
};

export const CANONICAL_TARGET_ROUTE_MAPPINGS: Readonly<
  Record<string, readonly TargetMapping[]>
> = {
  ...Object.fromEntries(Object.entries(DEFAULT_TARGET_MAPPINGS).map(
    ([requestedId, target]) => [requestedId, [target]],
  )),
  ...Object.fromEntries(Object.entries(LAUNCH_ALIAS_ROUTE_MAPPINGS).map(
    ([requestedId, targets]) => [requestedId, targets],
  )),
};

export const LAUNCH_ALIAS_TARGET_MAPPINGS = Object.fromEntries(
  Object.entries(LAUNCH_ALIAS_ROUTE_MAPPINGS)
    .map(([requestedId, targets]) => [requestedId, firstTargetThatResolvesProfile(targets)]),
);

export const CANONICAL_TARGET_MAPPINGS: Readonly<Record<string, TargetMapping>> =
  Object.fromEntries(Object.entries(CANONICAL_TARGET_ROUTE_MAPPINGS)
    .map(([requestedId, targets]) => [requestedId, firstTargetThatResolvesProfile(targets)]),
  );

export const createStaticTargetResolver = (options: {
  readonly mappings: Readonly<Record<string, TargetMapping>>;
}): ModelTargetResolver => (model) => options.mappings[model];

export interface CanonicalTargetResolverOptions {
  readonly musePosition?: MusePosition;
}

const canonicalTargetMappingsFor = (
  musePosition: MusePosition = DEFAULT_MUSE_POSITION,
): Readonly<Record<string, TargetMapping>> => {
  if (musePosition === DEFAULT_MUSE_POSITION) return CANONICAL_TARGET_MAPPINGS;
  return Object.fromEntries(
    Object.entries(launchAliasRouteMappingsFor(musePosition))
      .map(([requestedId, targets]) => [
        requestedId,
        firstTargetThatResolvesProfile(targets),
      ]),
  );
};

export const createCanonicalTargetResolver = (
  options: CanonicalTargetResolverOptions = {},
): ModelTargetResolver => createStaticTargetResolver({
  mappings: canonicalTargetMappingsFor(options.musePosition ?? DEFAULT_MUSE_POSITION),
});

export const createCanonicalTargetCandidatesResolver = (
  options: CanonicalTargetResolverOptions = {},
): ModelTargetCandidatesResolver => {
  const routeMappings = launchAliasRouteMappingsFor(
    options.musePosition ?? DEFAULT_MUSE_POSITION,
  );
  const merged: Readonly<Record<string, readonly TargetMapping[]>> = {
    ...Object.fromEntries(Object.entries(DEFAULT_TARGET_MAPPINGS).map(
      ([requestedId, target]) => [requestedId, [target]],
    )),
    ...Object.fromEntries(Object.entries(routeMappings).map(
      ([requestedId, targets]) => [requestedId, targets],
    )),
  };
  return (model) => merged[model] ?? [];
};

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
    );
